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

export function parseJsonl<T>(text: string | null): T[] {
  return (text ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
export const toJsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

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
