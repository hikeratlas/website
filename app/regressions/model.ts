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

// Douglas-Peucker, with the tolerance doubled from ~10 m until at most `max`
// points remain (as routes' apply-picks.py). The points kept are the line's
// own, so they sit on the trail.
export function simplify(line: LngLat[], max = 20): LngLat[] {
  const round = (p: LngLat): LngLat => [+p[0].toFixed(5), +p[1].toFixed(5)];
  if (line.length <= max) return line.map(round);
  const kx = Math.cos((line[0][1] * Math.PI) / 180) * 111320, ky = 110570;
  const xy = line.map(([x, y]) => [x * kx, y * ky]);
  const dp = (tol: number) => {
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
    return line.filter((_, i) => keep[i]);
  };
  for (let tol = 10; tol < 2000; tol *= 2) {
    const s = dp(tol);
    if (s.length <= max) return s.map(round);
  }
  return dp(2000).map(round);
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
  kind?: 'trail' | 'dest'; name: string; park: string; park_id: string; issue: string;
  km?: number; km_tolerance?: number; trail?: string; aka?: string[]; source?: string; why?: string;
  trace?: LngLat[]; trace_within_m?: number; trace_cover?: number; trace_note?: string;
  dest?: string; start?: LngLat; start_within_m?: number; max_km?: number;
  [k: string]: unknown;
}
export const entryKey = (e: Pick<Entry, 'kind' | 'name'>) => `${e.kind ?? 'dest'}|${e.name}`;

// A change to an existing entry, kept until committed.
export type EntryEdit =
  | { action: 'update'; km?: number; trace?: LngLat[]; how?: string; note?: string }
  | { action: 'delete'; note?: string };

// A name to compare, as routes' expectations.norm: 'The "Crack" Trail' and
// 'the crack' are the same.
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^0-9a-z]+/g, ' ').split(' ').filter((w) => w && w !== 'the' && w !== 'trail').join(' ');
}

// Whether a hike offered under `label` (its name) passes a trail entry with a
// trace, as routes' expect.py checks it: offered under the name, within
// km_tolerance of km, and within trace_within_m of trace_cover of the trace's
// points.
export function passes(e: Entry, label: string | null, km: number, line: LngLat[]): { name: boolean; length: boolean; follows: number; ok: boolean } {
  const names = new Set([e.name, e.trail, ...(e.aka ?? [])].filter(Boolean).map((n) => norm(n as string)));
  const name = label !== null && names.has(norm(label));
  const tol = e.km_tolerance ?? 0.3;
  const length = e.km !== undefined && km >= e.km * (1 - tol) && km <= e.km * (1 + tol);
  const follows = e.trace?.length ? walks([e.trace], line, e.trace_within_m ?? 50) : 0;
  return { name, length, follows, ok: name && length && follows >= (e.trace_cover ?? 0.7) };
}
