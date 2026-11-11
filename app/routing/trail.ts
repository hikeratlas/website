// A named trail's lines, from the basemap's z14 tiles (#242): what a trail
// picked in search is drawn with, and measured along.
//
// The trail's ways are the "path" features with its name in the tiles that
// cover its box. Tiles carry a buffer past their edges, so a way crossing
// from one tile to the next is in both, overlapping: each tile's copy is
// clipped to the tile's own bounds, so the two meet at its edge. Their edge
// vertices can land a unit or two apart, so vertices on a tile edge that
// close together are one (as in graph.ts). (Without the clipping, the copies
// don't meet, and most long trails came out in pieces, with no profile.) If the ways chain
// end to end into one line (no branches, one piece), it's returned in order
// as `single`, which can be profiled end to end. A branched trail in one piece
// (a lollipop: a stem into a loop, like Killarney's Granite Ridge Trail) has
// `longest` instead: its longest stretch, between its two farthest-apart
// points along it. A trail in separate pieces only has `lines`.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { Z, haversine, lngLatToTile, type LngLat } from './graph';

interface TileSource {
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
}

export interface TrailGeometry {
  lines: LngLat[][];
  single: LngLat[] | null;
  longest: LngLat[] | null;
}

// More tiles than this (~15-20 km across) and the trail isn't read: a long
// trail's box would take hundreds of fetches.
export const MAX_TILES = 256;

const SNAP = 4; // tile units: edge vertices this close are one

type Pt = [number, number];

// A tile line's pieces inside the tile (0..ext both ways), cut where it
// leaves; each copy of a way that crosses an edge then ends on the edge.
export function clip(line: { x: number; y: number }[], ext: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const end = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k];
    const dx = b.x - a.x, dy = b.y - a.y;
    // Liang-Barsky.
    let t0 = 0, t1 = 1, inside = true;
    for (const [p, q] of [[-dx, a.x], [dx, ext - a.x], [-dy, a.y], [dy, ext - a.y]]) {
      if (p === 0) { if (q < 0) inside = false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) inside = false; else if (r > t0) t0 = r; } else if (r < t0) inside = false; else if (r < t1) t1 = r;
    }
    if (!inside || t0 > t1) { end(); continue; }
    const s: Pt = [a.x + t0 * dx, a.y + t0 * dy];
    const e: Pt = [a.x + t1 * dx, a.y + t1 * dy];
    const last = cur[cur.length - 1];
    if (!last || last[0] !== s[0] || last[1] !== s[1]) { end(); cur.push(s); }
    cur.push(e);
    if (t1 < 1) end(); // it leaves the tile here
  }
  end();
  return out;
}

export function tilesFor(box: [number, number, number, number]): [number, number][] | null {
  // lngLatToTile is fractional (a point within its tile): whole tiles here.
  const [x0, y0] = lngLatToTile(box[0], box[3], Z).map(Math.floor);
  const [x1, y1] = lngLatToTile(box[2], box[1], Z).map(Math.floor);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

export async function trailGeometry(source: TileSource, name: string, box: [number, number, number, number]): Promise<TrailGeometry | null> {
  const tiles = tilesFor(box);
  if (!tiles) return null;
  const want = name.trim().toLowerCase();
  const results = await Promise.all(tiles.map(([x, y]) => source.getZxy(Z, x, y).then((r) => [x, y, r] as const)));

  // Vertices by key; edges between consecutive vertices of each line.
  const at = new Map<string, LngLat>();
  const adj = new Map<string, Set<string>>();
  const lines: LngLat[][] = [];
  let ext = 4096;
  const toLngLat = (wx: number, wy: number): LngLat => {
    const n = ext * 2 ** Z;
    const lng = (wx / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / n))) * 180) / Math.PI;
    return [lng, lat];
  };
  for (const [tx, ty, r] of results) {
    if (!r) continue;
    const layer = new VectorTile(new PbfReader(new Uint8Array(r.data))).layers.path;
    if (!layer) continue;
    ext = layer.extent;
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f);
      if (feature.type !== 2 || String(feature.properties.name ?? '').trim().toLowerCase() !== want) continue;
      for (const piece of feature.loadGeometry().flatMap((part) => clip(part, ext))) {
        const line: LngLat[] = [];
        let prev: string | null = null;
        for (const [px, py] of piece) {
          const wx = tx * ext + px, wy = ty * ext + py;
          const onEdge = px <= 0 || px >= ext || py <= 0 || py >= ext;
          const key = onEdge ? `e${Math.round(wx / SNAP)},${Math.round(wy / SNAP)}` : `${wx},${wy}`;
          if (!at.has(key)) at.set(key, toLngLat(wx, wy));
          line.push(at.get(key)!);
          if (prev !== null && prev !== key) {
            if (!adj.has(prev)) adj.set(prev, new Set());
            if (!adj.has(key)) adj.set(key, new Set());
            adj.get(prev)!.add(key);
            adj.get(key)!.add(prev);
          }
          prev = key;
        }
        if (line.length > 1) lines.push(line);
      }
    }
  }
  if (lines.length === 0) return { lines, single: null, longest: null };
  const single = chain(adj, at);
  return { lines, single, longest: single ? null : longestStretch(adj, at) };
}

// In a trail of one piece, the path between its two farthest-apart points:
// the farthest point from anywhere, then the farthest from that (along the
// trail). Null if the trail is in more than one piece.
function longestStretch(adj: Map<string, Set<string>>, at: Map<string, LngLat>): LngLat[] | null {
  const far = (from: string) => {
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    // Dijkstra with a plain scan: trails have hundreds of vertices, not more.
    for (;;) {
      let u: string | null = null;
      for (const [k, d] of dist) if (!done.has(k) && (u === null || d < dist.get(u)!)) u = k;
      if (u === null) break;
      done.add(u);
      for (const v of adj.get(u)!) {
        const d = dist.get(u)! + haversine(at.get(u)!, at.get(v)!);
        if (d < (dist.get(v) ?? Infinity)) { dist.set(v, d); prev.set(v, u); }
      }
    }
    let end = from;
    for (const [k, d] of dist) if (d > dist.get(end)!) end = k;
    return { end, prev, reached: dist.size };
  };
  const first = adj.keys().next().value;
  if (first === undefined) return null;
  const a = far(first);
  if (a.reached !== adj.size) return null; // in pieces
  const b = far(a.end);
  const out: LngLat[] = [];
  for (let k: string | undefined = b.end; k !== undefined; k = b.prev.get(k)) out.push(at.get(k)!);
  return out.length > 1 ? out : null;
}

// The vertices in order, if they form one unbranched line (or loop).
function chain(adj: Map<string, Set<string>>, at: Map<string, LngLat>): LngLat[] | null {
  for (const n of adj.values()) if (n.size > 2) return null;
  const ends = [...adj.keys()].filter((k) => adj.get(k)!.size === 1);
  if (ends.length !== 0 && ends.length !== 2) return null;
  const start = ends[0] ?? adj.keys().next().value!;
  const out: LngLat[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = start;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    out.push(at.get(cur)!);
    cur = [...adj.get(cur)!].find((k) => !seen.has(k));
  }
  if (ends.length === 0) out.push(at.get(start)!); // a loop closes
  // Every vertex visited: one piece. Otherwise it's in several.
  return seen.size === adj.size ? out : null;
}
