// The curation database (curation/migrations/0001_init.sql): a row per
// trail. Read everything, check a curator's key, and save changed rows as
// one atomic batch, each from the rev it was read at. Kept apart from the
// route that serves it so it can be tested on SQLite (store.test.ts).

export type Table = 'listed' | 'trail';
const TABLE: Record<Table, 'listed_trail' | 'trail'> = { listed: 'listed_trail', trail: 'trail' };

export type Box = [number, number, number, number];
export interface ParkRow { park_id: string; name: string; region: string; stem: string; bbox: Box | null }
// A park in the list: its counts, kept by triggers (0002_park_counts.sql).
export interface ParkSummary extends ParkRow { listed_n: number; open_n: number; trail_n: number }
// A live row: data is the row as routes' files spell it.
export interface Row { id: string; park_id: string; pos: number; rev: number; data: string }
// Some parks, whole. `head`: the newest revision when read, for routes'
// export to ask for what changed since.
export interface Parks { head: number; parks: ParkRow[]; listed: Row[]; trails: Row[] }

const parkOf = (p: Omit<ParkRow, 'bbox'> & { bbox: string | null }) => ({ ...p, bbox: p.bbox ? JSON.parse(p.bbox) as Box : null });
const HEAD = 'SELECT COALESCE(MAX(id), 0) AS head FROM revision';

// Every park, with its counts but not its rows: a row read a park.
export async function readParks(db: D1Database): Promise<{ head: number; parks: ParkSummary[] }> {
  const [h, ps] = await db.batch([
    db.prepare(HEAD),
    db.prepare('SELECT park_id, name, region, stem, bbox, listed_n, open_n, trail_n FROM park ORDER BY name'),
  ]);
  return { head: (h.results[0] as { head: number }).head, parks: (ps.results as Parameters<typeof parkOf>[0][]).map(parkOf) as ParkSummary[] };
}

// The parks given, whole (their rows by the park index).
async function readWhole(db: D1Database, ids: string[]): Promise<Parks> {
  const q = JSON.stringify(ids);
  const [h, ps, listed, trails] = await db.batch([
    db.prepare(HEAD),
    db.prepare('SELECT park_id, name, region, stem, bbox FROM park WHERE park_id IN (SELECT value FROM json_each(?)) ORDER BY name').bind(q),
    db.prepare('SELECT id, park_id, pos, rev, data FROM listed_trail WHERE park_id IN (SELECT value FROM json_each(?)) AND data IS NOT NULL ORDER BY park_id, pos').bind(q),
    db.prepare('SELECT id, park_id, pos, rev, data FROM trail WHERE park_id IN (SELECT value FROM json_each(?)) AND data IS NOT NULL ORDER BY park_id, pos').bind(q),
  ]);
  return {
    head: (h.results[0] as { head: number }).head,
    parks: (ps.results as Parameters<typeof parkOf>[0][]).map(parkOf),
    listed: listed.results as unknown as Row[],
    trails: trails.results as unknown as Row[],
  };
}

// One park, whole (it may not be saved yet: no parks).
export const readPark = (db: D1Database, id: string) => readWhole(db, [id]);

// The parks with a row saved after revision `since`, whole: routes' export
// asks for what changed since its last (0: everything). Found from the
// revisions after `since`, by their key, so a night without changes reads
// next to nothing.
export async function readChanged(db: D1Database, since: number): Promise<Parks> {
  const r = await db.prepare(`SELECT DISTINCT park_id FROM (
      SELECT l.park_id FROM revision r JOIN listed_trail l ON l.id = r.item_id WHERE r.id > ?1 AND r.tbl = 'listed_trail'
      UNION SELECT t.park_id FROM revision r JOIN trail t ON t.id = r.item_id WHERE r.id > ?1 AND r.tbl = 'trail')`).bind(since).all<{ park_id: string }>();
  return readWhole(db, r.results.map((x) => x.park_id));
}

// The curator a request's key belongs to ("Authorization: Bearer <key>"),
// or null. CURATOR_KEYS is "name:key,name:key".
export function curatorFor(header: string | null, keys: string | undefined): string | null {
  const given = header?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!given || !keys) return null;
  let who: string | null = null;
  for (const pair of keys.split(',')) {
    const i = pair.indexOf(':');
    if (i <= 0) continue;
    if (same(pair.slice(i + 1).trim(), given)) who = pair.slice(0, i).trim();
  }
  return who;
}

// Compares every character whatever the first difference, so the time
// taken says nothing about how much of a key was right.
function same(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// A row to save: new (base 0, with an id the page makes), changed, or
// removed (data null). `pos` places a new row; without it, it goes last.
export interface Change { table: Table; id: string; park_id: string; base: number; data: string | null; pos?: number }
export interface Save { parks?: ParkRow[]; changes: Change[]; message: string }
export type SaveResult = { ok: true; revs: Record<string, number> } | { ok: false; status: number; error: string; stale?: string[] };

// A query a row (the revision is a trigger's), plus a few: under D1's Free
// plan's 50 queries a request.
export const MAX_CHANGES = 40;

const ID = /^[A-Za-z0-9-]{1,64}$/;
const PARK_ID = /^\d{1,20}$/;
const STEM = /^[a-z0-9-]{1,120}$/;

function invalid(s: Save): string | null {
  if (!s || typeof s !== 'object' || !Array.isArray(s.changes)) return 'needs changes';
  if (typeof s.message !== 'string' || !s.message.trim()) return 'a save needs a message';
  const parks = s.parks ?? [];
  if (!Array.isArray(parks)) return 'parks must be a list';
  if (!s.changes.length && !parks.length) return 'nothing to save';
  if (s.changes.length > MAX_CHANGES) return `at most ${MAX_CHANGES} rows a save (${s.changes.length} here): save fewer at once`;
  for (const p of parks) {
    if (!p || !PARK_ID.test(String(p.park_id)) || typeof p.name !== 'string' || !p.name || !STEM.test(String(p.stem))) return `not a park: ${JSON.stringify(p).slice(0, 120)}`;
    if (p.bbox != null && !(Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every((x) => typeof x === 'number' && Number.isFinite(x)))) return `not a box: ${p.park_id}`;
  }
  const seen = new Set<string>();
  for (const c of s.changes) {
    if (!c || !(c.table in TABLE) || !ID.test(String(c.id)) || !PARK_ID.test(String(c.park_id))) return `not a row: ${JSON.stringify(c).slice(0, 120)}`;
    if (!Number.isInteger(c.base) || c.base < 0) return `not a rev: ${c.id}`;
    if (c.pos != null && !Number.isInteger(c.pos)) return `not a position: ${c.id}`;
    if (seen.has(`${c.table}/${c.id}`)) return `twice in one save: ${c.id}`;
    seen.add(`${c.table}/${c.id}`);
    if (c.data === null) continue;
    let row: unknown;
    try { row = JSON.parse(c.data); } catch { return `not JSON: ${c.id}`; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) return `not an object: ${c.id}`;
    const pid = (row as { park_id?: unknown }).park_id;
    if (pid !== undefined && String(pid) !== String(c.park_id)) return `park_id ${String(pid)} isn't the row's park ${c.park_id}: ${c.id}`;
  }
  return null;
}

export async function saveRows(db: D1Database, s: Save, author: string, now = new Date()): Promise<SaveResult> {
  const bad = invalid(s);
  if (bad) return { ok: false, status: 400, error: bad };
  const at = now.toISOString();
  const parks = s.parks ?? [];
  // Every row's park must be known: saved before, or in this save.
  const parkIds = [...new Set(s.changes.map((c) => String(c.park_id)))];
  const known = new Set([
    ...parks.map((p) => String(p.park_id)),
    ...(await db.prepare('SELECT park_id FROM park WHERE park_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(parkIds)).all<{ park_id: string }>()).results.map((r) => r.park_id),
  ]);
  const unknown = parkIds.filter((p) => !known.has(p));
  if (unknown.length) return { ok: false, status: 400, error: `unknown park: ${unknown.join(', ')} (send it in parks)` };
  // Changed since read: the page reloads, and the curator saves again.
  const revs = new Map<string, number>();
  for (const t of Object.keys(TABLE) as Table[]) {
    const ids = s.changes.filter((c) => c.table === t).map((c) => c.id);
    if (!ids.length) continue;
    const r = await db.prepare(`SELECT id, rev FROM ${TABLE[t]} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{ id: string; rev: number }>();
    for (const x of r.results) revs.set(`${t}/${x.id}`, x.rev);
  }
  const stale = s.changes.filter((c) => (revs.get(`${c.table}/${c.id}`) ?? 0) !== c.base).map((c) => c.id);
  if (stale.length) return { ok: false, status: 409, error: 'changed since it was read', stale };

  const stmts: D1PreparedStatement[] = parks.map((p) => db.prepare(`INSERT INTO park (park_id, name, region, stem, bbox, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (park_id) DO UPDATE SET name = excluded.name, region = CASE WHEN excluded.region = '' THEN park.region ELSE excluded.region END,
      stem = excluded.stem, bbox = COALESCE(excluded.bbox, park.bbox), updated_at = excluded.updated_at`)
    .bind(String(p.park_id), p.name, p.region ?? '', p.stem, p.bbox ? JSON.stringify(p.bbox) : null, at));
  const out: Record<string, number> = {};
  for (const c of s.changes) {
    const t = TABLE[c.table], rev = c.base + 1;
    out[c.id] = rev;
    const row = c.data === null ? {} : JSON.parse(c.data) as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : null;
    const third = c.table === 'listed' ? (typeof row.status === 'string' ? row.status : null) : (typeof row.kind === 'string' ? row.kind : 'dest');
    const col = c.table === 'listed' ? 'status' : 'kind';
    // The revision row comes from the table's trigger; its unique key fails
    // a save racing this one from the same rev, and the whole batch with it.
    stmts.push(c.base === 0
      ? db.prepare(`INSERT INTO ${t} (id, park_id, pos, rev, data, name, ${col}, updated_at, updated_by, message)
          VALUES (?1, ?2, COALESCE(?3, (SELECT COALESCE(MAX(pos), -1) + 1 FROM ${t} WHERE park_id = ?2)), ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
        .bind(c.id, String(c.park_id), c.pos ?? null, rev, c.data, name, third, at, author, s.message)
      : db.prepare(`UPDATE ${t} SET rev = ?, data = ?, name = ?, ${col} = ?, updated_at = ?, updated_by = ?, message = ? WHERE id = ?`)
        .bind(rev, c.data, name, third, at, author, s.message, c.id));
  }
  try {
    await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { ok: false, status: 409, error: `a clash saving (changed meanwhile, or a park's file name taken): ${String(e).slice(0, 200)}` };
    throw e;
  }
  return { ok: true, revs: out };
}
