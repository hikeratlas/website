// A named trail's lines, from the basemap's z14 tiles (#242): what a trail
// picked in search is drawn with, and measured along.
//
// The trail's ways are the "path" features with its name in the tiles that
// cover its box. Tiles cut lines at their edges, adding a vertex there in
// each tile; the two copies can land a unit or two apart, so vertices on a
// tile edge that close together are one (as in graph.ts). If the ways chain
// end to end into one line (no branches, one piece), it's returned in order
// as `single`, which can be profiled end to end; a branched or broken trail
// (a loop with spurs, separate stretches) only has `lines`.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { Z, lngLatToTile, type LngLat } from './graph';

interface TileSource {
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
}

export interface TrailGeometry {
  lines: LngLat[][];
  single: LngLat[] | null;
}

// More tiles than this (~15-20 km across) and the trail isn't read: a long
// trail's box would take hundreds of fetches.
export const MAX_TILES = 256;

const SNAP = 4; // tile units: edge vertices this close are one

export function tilesFor(box: [number, number, number, number]): [number, number][] | null {
  const [x0, y0] = lngLatToTile(box[0], box[3], Z);
  const [x1, y1] = lngLatToTile(box[2], box[1], Z);
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
      for (const part of feature.loadGeometry()) {
        const line: LngLat[] = [];
        let prev: string | null = null;
        for (const p of part) {
          const wx = tx * ext + p.x, wy = ty * ext + p.y;
          const onEdge = p.x <= 0 || p.x >= ext || p.y <= 0 || p.y >= ext;
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
  if (lines.length === 0) return { lines, single: null };
  return { lines, single: chain(adj, at) };
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
