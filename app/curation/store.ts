// The curation database's files (curation/migrations/0001_init.sql): read
// them all, check a curator's key, and save changed files as one atomic
// batch. Kept apart from the routes that serve it so it can be tested on
// SQLite (store.test.ts).

// The managed paths: routes' files the page edits. Nothing else is saved.
const PATH = /^fixtures\/(proposals\/[a-z0-9-]+\.jsonl|expect\/[a-z0-9-]+\.jsonl|parks\.json)$/;
export const isCuratedPath = (p: string) => PATH.test(p);

export interface CuratedFile { path: string; content: string; rev: number }

export async function readFiles(db: D1Database): Promise<CuratedFile[]> {
  const r = await db.prepare('SELECT path, content, rev FROM file ORDER BY path').all<CuratedFile>();
  return r.results;
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

export interface Save {
  files: Record<string, string>;   // path -> new content ('' removes it)
  base: Record<string, number>;    // path -> the rev it was read at (0: didn't exist)
  message: string;
}
export type SaveResult = { ok: true; revs: Record<string, number> } | { ok: false; status: number; error: string; stale?: string[] };

export async function saveFiles(db: D1Database, s: Save, author: string, now = new Date()): Promise<SaveResult> {
  const paths = Object.keys(s.files);
  if (!paths.length) return { ok: false, status: 400, error: 'nothing to save' };
  const bad = paths.filter((p) => !isCuratedPath(p) || typeof s.files[p] !== 'string');
  if (bad.length) return { ok: false, status: 400, error: `not a curated file: ${bad.join(', ')}` };
  if (!s.message?.trim()) return { ok: false, status: 400, error: 'a save needs a message' };
  const current = new Map((await readFiles(db)).map((f) => [f.path, f.rev]));
  // Changed since it was read: the page reloads, and the curator saves again.
  const stale = paths.filter((p) => (current.get(p) ?? 0) !== (s.base[p] ?? 0));
  if (stale.length) return { ok: false, status: 409, error: 'changed since it was read', stale };
  const at = now.toISOString();
  const revs: Record<string, number> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const p of paths) {
    const rev = (s.base[p] ?? 0) + 1;
    revs[p] = rev;
    // First, so a save racing this one from the same rev fails here, on the
    // unique key, and the whole batch with it.
    stmts.push(db.prepare('INSERT INTO file_rev (path, rev, content, author, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(p, rev, s.files[p], author, s.message, at));
    stmts.push(db.prepare(`INSERT INTO file (path, content, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET content = excluded.content, rev = excluded.rev, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(p, s.files[p], rev, at, author));
  }
  try {
    await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { ok: false, status: 409, error: 'changed while saving', stale: paths };
    throw e;
  }
  return { ok: true, revs };
}
