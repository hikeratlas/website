// The regressions page's data: hikeratlas/routes' proposed named regressions
// (fixtures/proposals/, routes' proposals.py) and the entries they become
// (fixtures/expect/, routes' expectations.py and expect.py).
import type { LngLat } from '~/routing/graph';
import { haversine } from '~/routing/graph';

export interface Proposal {
  park: string; park_id: string; region: string; name: string; km: number; source: string;
  status: 'open' | 'accepted' | 'rejected';
  quote?: string; km_basis?: string; why?: string; hours?: number | string; elev_m?: number; issue?: string;
  park_bbox?: [number, number, number, number];
  osm_trail?: string; osm_bbox?: [number, number, number, number]; osm_km?: number;
  suggest_km?: number; suggest_why?: string; note?: string;
  // No OSM trail of its name: the place its name goes to, and a box around
  // it to frame (routes' locate-proposals.py).
  near?: string; near_bbox?: [number, number, number, number];
}

// A park's file: <region>-<park>, as both directories name them.
export interface ParkFile { stem: string; park: string; park_id: string; region: string; proposals: Proposal[] }

export const key = (p: Pick<Proposal, 'name' | 'km'>) => `${p.name}|${p.km}`;

// What you've decided about one proposal, kept until committed.
export interface Decision {
  status: 'accepted' | 'rejected';
  km?: number;            // accepted: the length to expect
  trace?: LngLat[];       // accepted: the hike meant, simplified
  how?: string;           // accepted: "Moose Lake from X (6.1 km)" or "drawn"
  note?: string;
}

// Each parsed row's line as it was in the file: written back unchanged, so a
// commit's diff shows only the rows it changed. A changed row is a new
// object (copy it before changing it), so it has no line here.
const RAW = new WeakMap<object, string>();

export function parseJsonl<T>(text: string | null): T[] {
  return (text ?? '').split('\n').filter((l) => l.trim()).map((l) => {
    const row = JSON.parse(l) as T;
    if (row && typeof row === 'object') RAW.set(row as object, l);
    return row;
  });
}

// JSON as routes' Python tools write it (json.dumps with ensure_ascii=False):
// ", " between items and ": " after keys, so new and changed rows look like
// the rest of the file.
export function pyJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`;
  }
  return JSON.stringify(v);
}

// A copy of a parsed row with some top-level string fields set. Where its
// line can be patched in place (each field present as a string in it, or
// absent and appended), the copy keeps that patched line, so its diff is
// just those fields and numbers keep their spelling (Python's 17.0).
export function withFields<T extends object>(row: T, fields: Record<string, string>): T {
  const next = { ...row, ...fields };
  let line = RAW.get(row);
  if (line === undefined) return next;
  for (const [k, v] of Object.entries(fields)) {
    const old = (row as Record<string, unknown>)[k];
    const val = JSON.stringify(v);
    if (old === undefined) line = line.replace(/\}\s*$/, `, ${JSON.stringify(k)}: ${val}}`);
    else if (typeof old === 'string' && line.includes(`${JSON.stringify(k)}: ${JSON.stringify(old)}`)) line = line.replace(`${JSON.stringify(k)}: ${JSON.stringify(old)}`, `${JSON.stringify(k)}: ${val}`);
    else return next;  // not in the spelling expected: write the row anew
  }
  RAW.set(next, line);
  return next;
}

export const toJsonl = (rows: unknown[]) => rows.map((r) => (r && typeof r === 'object' && RAW.get(r as object)) || pyJson(r)).join('\n') + '\n';

// The entry an accepted proposal becomes: a trail entry with a trace (see
// routes' expect.py), so it's checked against the hike meant rather than the
// OSM ways of its name.
export function entryFor(p: Proposal, d: Decision): Record<string, unknown> {
  return {
    kind: 'trail', park: p.park, park_id: p.park_id, issue: p.issue ?? 'routes#95', source: p.source,
    name: p.name, km: d.km ?? p.km, ...(p.why ? { why: p.why } : {}), trace: d.trace,
    ...(d.note ? { trace_note: d.note } : {}),
  };
}

// Douglas-Peucker at a fixed tolerance (metres), so a trace keeps the hike's
// shape and length however long it is: routes' expect.py also measures a
// trace's length, and a few points on a winding trail cut its corners (a cap
// of 20 points made La Cloche's 80 km loop a 46 km trace). The points kept
// are the line's own, the first and last exactly: the first is the
// trailhead, which expect.py checks.
export const TRACE_TOLERANCE_M = 10;
export function simplify(line: LngLat[], tol = TRACE_TOLERANCE_M): LngLat[] {
  const round = (p: LngLat): LngLat => [+p[0].toFixed(5), +p[1].toFixed(5)];
  if (line.length <= 2) return line.map(round);
  const kx = Math.cos((line[0][1] * Math.PI) / 180) * 111320, ky = 110570;
  const xy = line.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, far = tol;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > far) { far = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  // Rounded to 5 decimals (~1 m); consecutive repeats dropped.
  return line.filter((_, i) => keep[i]).map(round).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
}

// The share of a trail's points within `m` metres of a route's line: how much
// of the trail the route walks (roughly; vertices, not length).
export function walks(trail: LngLat[][], line: LngLat[], m = 60): number {
  const pts = trail.flat();
  if (!pts.length || line.length < 2) return 0;
  const kx = Math.cos((pts[0][1] * Math.PI) / 180) * 111320, ky = 110570;
  const seg = line.map(([x, y]) => [x * kx, y * ky]);
  let near = 0;
  for (const [x, y] of pts) {
    const px = x * kx, py = y * ky;
    for (let i = 1; i < seg.length; i++) {
      const [ax, ay] = seg[i - 1], [bx, by] = seg[i];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      if (Math.hypot(px - ax - t * dx, py - ay - t * dy) <= m) { near++; break; }
    }
  }
  return near / pts.length;
}

export const lineKm = (line: LngLat[]) => line.slice(1).reduce((s, p, i) => s + haversine(line[i], p), 0) / 1000;

// A fixture for routes' fixtures/parks.json, for a park that gets entries
// (its README: a park with entries should be a fixture too, so CI runs it).
export function fixtureFor(f: ParkFile, bbox: [number, number, number, number]) {
  const short = f.park.replace(/ (National|Provincial|Interprovincial|State) Park.*$| Park$/, '');
  const key = short.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { key, id: f.park_id, park: f.park, why: 'quality: park-listed trails as named regressions (routes#95)', bbox };
}

// An entry in fixtures/expect/ (routes' expectations.py): a trail entry, or
// a dest entry (a route to `dest` from near `start`).
export interface Entry {
  kind?: 'trail' | 'dest'; name: string; park: string; park_id: string; issue?: string;
  km?: number; km_tolerance?: number; trail?: string; aka?: string[]; source?: string; why?: string;
  trace?: LngLat[]; traces?: LngLat[][]; trace_within_m?: number; trace_cover?: number; trace_start_m?: number | null; trace_end_m?: number | null; trace_note?: string;
  dest?: string; start?: LngLat; start_within_m?: number; max_km?: number;
  // A hike routes offered, kept as it was (see blessedEntry).
  blessed?: Blessed;
  [k: string]: unknown;
}
export interface Blessed { key: string; km: number; date?: string; build?: string }

// A file's name for a park: <region>-<park>, slugged, as routes' expectations.slug.
export const slug = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// What the site calls a hike, as routes' expect.py does (its title()): its
// name, else "<dest> from <where it starts>". A blessed entry is named this.
export function hikeTitle(name: string | null | undefined, dest: string, from: string): string {
  return name || `${dest} from ${from}`;
}

// The entry that keeps a hike routes offers now as it is (routes' expect.py,
// "blessed"): named as the site calls it, its length, its line as the trace,
// and which route it was.
export function blessedEntry(park: { park: string; park_id: string }, h: { title: string; key: string; km: number; line: LngLat[] }, build: string): Entry {
  return {
    kind: 'trail', park: park.park, park_id: park.park_id, name: h.title, km: h.km, trace: simplify(h.line),
    blessed: { key: h.key, km: h.km, date: new Date().toISOString().slice(0, 10), build },
  };
}
export const entryKey = (e: Pick<Entry, 'kind' | 'name'>) => `${e.kind ?? 'dest'}|${e.name}`;

// A change to an existing entry, kept until committed.
export type EntryEdit =
  | { action: 'update'; km?: number; trace?: LngLat[]; addTrace?: boolean; how?: string; note?: string }
  | { action: 'delete'; note?: string };

// A name to compare, as routes' expectations.norm: 'The "Crack" Trail' and
// 'the crack' are the same, and so are "Benjie's Lake" and 'Benjies Lake'.
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/['\u2019]/g, '').replace(/[^0-9a-z]+/g, ' ').split(' ').filter((w) => w && w !== 'the' && w !== 'trail').join(' ');
}

// Whether a hike offered under `label` (its name; for a blessed entry, its
// title, hikeTitle) or, unless blessed, going to `dest` (its destination, as
// the site titles it: routes#177) passes a trail entry with a
// trace, as routes' expect.py checks it: offered under the name, within
// km_tolerance of km or within 0.85-1.4 times the trace's own length (a
// trace says which hike is meant better than a park's rounded figure; it cuts
// corners, so it's shorter than the hike), starting (its line's first point) within trace_start_m
// of the trace's first point, the trailhead (null: not checked), ending (its
// last point) within trace_end_m of the trace's last point (null: not
// checked), and within
// trace_within_m of trace_cover of the trace's points.
export const TRACE_KM: [number, number] = [0.85, 1.4];
export const BLESSED_TOLERANCE = 0.15;
// An entry's traces: `trace`, then `traces`, the same hike other ways (from
// another lot: Tunnel Mountain Summit Trail's two, routes#152).
export function entryTraces(e: Entry): LngLat[][] {
  return e.trace?.length ? [e.trace, ...(e.traces ?? [])] : (e.traces ?? []);
}
export type Check = { name: boolean; length: boolean; byTrace: boolean; start: boolean | null; startOff: number | null; end: boolean | null; endOff: number | null; follows: number; ok: boolean; trace?: number };
// Against each of the entry's traces, keeping the best, as expect.py does:
// passing, else the fewest failed checks. `trace` is which one (0-based).
export function passes(e: Entry, label: string | null, km: number, line: LngLat[], dest: string | null = null): Check {
  const ts = entryTraces(e);
  if (ts.length < 2) return passesOne(e, ts[0], label, km, line, dest);
  const failed = (c: Check) => [c.name, c.length, c.start, c.end, c.follows >= (e.trace_cover ?? 0.7)].filter((v) => v === false).length;
  let best: Check | null = null;
  ts.forEach((t, i) => {
    const c = { ...passesOne(e, t, label, km, line, dest), trace: i };
    if (!best || (c.ok && !best.ok) || (c.ok === best.ok && failed(c) < failed(best))) best = c;
  });
  return best!;
}
function passesOne(e: Entry, trace: LngLat[] | undefined, label: string | null, km: number, line: LngLat[], dest: string | null): Check {
  const names = new Set([e.name, e.trail, ...(e.aka ?? [])].filter(Boolean).map((n) => norm(n as string)));
  const name = (label !== null && names.has(norm(label))) || (!e.blessed && dest !== null && names.has(norm(dest)));
  // A blessed entry: within 15% of its own km, not by the trace.
  const tol = e.km_tolerance ?? (e.blessed ? BLESSED_TOLERANCE : 0.3);
  const byPark = e.km !== undefined && km >= e.km * (1 - tol) && km <= e.km * (1 + tol);
  const tk = trace?.length && !e.blessed ? lineKm(trace) : 0;
  const byTrace = !byPark && tk > 0 && km >= tk * TRACE_KM[0] && km <= tk * TRACE_KM[1];
  const length = byPark || byTrace;
  const follows = trace?.length ? walks([trace], line, e.trace_within_m ?? 50) : 0;
  const startM = e.trace_start_m === undefined ? 150 : e.trace_start_m;
  const startOff = trace?.length && line.length ? haversine(trace[0], line[0]) : null;
  const start = startM === null ? null : startOff !== null && startOff <= startM;
  const endM = e.trace_end_m === undefined ? 150 : e.trace_end_m;
  const endOff = trace?.length && line.length ? haversine(trace[trace.length - 1], line[line.length - 1]) : null;
  const end = endM === null ? null : endOff !== null && endOff <= endM;
  return { name, length, byTrace, start, startOff, end, endOff, follows, ok: name && length && start !== false && end !== false && follows >= (e.trace_cover ?? 0.7) };
}
