// Routing on the basemap's own vector tiles, in the browser.
//
// The z14 tiles carry trails ("path") and roads ("road") at full detail. Two
// lines that share an OSM node share a vertex, at the same tile coordinates,
// so the tiles around a route make a routing graph: vertices are nodes, and
// consecutive vertices of a line are edges.
//
// Tiles cut lines at their edges, adding a vertex there in each tile. The two
// copies should land on the same point, but rounding can put them a unit or
// two apart, so vertices on a tile edge that close together are merged.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// The zoom routing reads tiles at, unless told otherwise. The basemap's path
// and road layers hold the same trails and roads from z12 up (paths from z8
// in parks, z10 outside; roads by z11), unsimplified; lower zooms have
// coarser coordinates (z12: ~1.5 m a unit at 50°N, z14: ~0.4 m) and cover
// 4x the area per zoom, so long legs can be routed from far fewer tiles.
export const Z = 14;
const LAYERS = ['path', 'road'];
const R = 6371008.8;

export type LngLat = [number, number];

// Paths walkers may not use. The basemap keeps foot=no paths (bike-only
// trails) and drops foot=private and foot=use_sidepath ones, but check all
// three in case that changes.
export function isFootForbidden(props: Record<string, unknown>): boolean {
  const foot = props.foot;
  return foot === 'no' || foot === 'private' || foot === 'use_sidepath';
}

// Closed trails: the basemap flags paths with access=no (and no foot
// permission) or a mapper's "Trail Closed" name as closed=true. They're
// drawn, greyed out, but routes shouldn't use them.
export function isClosed(props: Record<string, unknown>): boolean {
  return props.closed === true;
}

interface TileSource {
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
}

export interface Graph {
  // Node i is at (xs[i], ys[i]), in world coordinates: tile x * extent + x.
  xs: number[];
  ys: number[];
  adj: { to: number; m: number }[][];
  extent: number;
  // The tiles' zoom.
  z: number;
}

export function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return [x, y];
}

export function worldToLngLat(g: Graph, i: number): LngLat {
  const n = 2 ** g.z * g.extent;
  const lng = (g.xs[i] / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * g.ys[i]) / n))) * 180) / Math.PI;
  return [lng, lat];
}

export function haversine(a: LngLat, b: LngLat): number {
  const [lo1, la1] = a.map((v) => (v * Math.PI) / 180);
  const [lo2, la2] = b.map((v) => (v * Math.PI) / 180);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The tiles (at zoom z) covering two points, with a margin so the route can
// wander outside the box between them.
export function tilesAround(a: LngLat, b: LngLat, maxTiles = 600, z = Z): [number, number][] {
  const [ax, ay] = lngLatToTile(a[0], a[1], z);
  const [bx, by] = lngLatToTile(b[0], b[1], z);
  // At least two z14 tiles' width (half a tile at z12), or 40% of the span.
  const margin = Math.max(2 * 2 ** (z - Z), 0.4 * Math.max(Math.abs(ax - bx), Math.abs(ay - by)));
  const x0 = Math.floor(Math.min(ax, bx) - margin), x1 = Math.floor(Math.max(ax, bx) + margin);
  const y0 = Math.floor(Math.min(ay, by) - margin), y1 = Math.floor(Math.max(ay, by) + margin);
  const tiles: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  if (tiles.length > maxTiles) throw new Error(`Those points are too far apart for this prototype (${tiles.length} tiles)`);
  return tiles;
}

export async function buildGraph(source: TileSource, tiles: [number, number][], phase: (name: string) => void = () => {}, z = Z): Promise<Graph> {
  const g: Graph = { xs: [], ys: [], adj: [], extent: 4096, z };
  const ids = new Map<string, number>();
  const edgeNodes: number[] = [];
  const node = (x: number, y: number, onEdge: boolean) => {
    const key = `${x},${y}`;
    let i = ids.get(key);
    if (i === undefined) {
      i = g.xs.length;
      ids.set(key, i);
      g.xs.push(x); g.ys.push(y); g.adj.push([]);
      if (onEdge) edgeNodes.push(i);
    }
    return i;
  };

  const results = await Promise.all(tiles.map(([x, y]) => source.getZxy(z, x, y).then((r) => [x, y, r] as const)));
  phase('fetch tiles');
  for (const [tx, ty, r] of results) {
    if (!r) continue;
    const vt = new VectorTile(new PbfReader(new Uint8Array(r.data)));
    for (const name of LAYERS) {
      const layer = vt.layers[name];
      if (!layer) continue;
      const ext = layer.extent;
      g.extent = ext;
      for (let f = 0; f < layer.length; f++) {
        const feature = layer.feature(f);
        if (feature.type !== 2) continue; // lines only
        // Bike-only trails (foot=no) are in the tiles so the map can show
        // them, but this plans walking routes. Closed trails likewise.
        if (isFootForbidden(feature.properties) || isClosed(feature.properties)) continue;
        for (const line of feature.loadGeometry()) {
          let prev = -1;
          for (const p of line) {
            const onEdge = p.x <= 0 || p.x >= ext || p.y <= 0 || p.y >= ext;
            const i = node(tx * ext + p.x, ty * ext + p.y, onEdge);
            if (prev >= 0 && prev !== i) addEdge(g, prev, i);
            prev = i;
          }
        }
      }
    }
  }
  phase('decode');
  joinEdgeNodes(g, edgeNodes);
  phase('join');
  return g;
}

function addEdge(g: Graph, a: number, b: number) {
  const m = haversine(worldToLngLat(g, a), worldToLngLat(g, b));
  g.adj[a].push({ to: b, m });
  g.adj[b].push({ to: a, m });
}

// Join the copies of a line cut at a tile edge: vertices on tile edges within
// 3 units (under 2 m at z14, ~5 m at z12) of each other become connected by a 0 m edge.
function joinEdgeNodes(g: Graph, nodes: number[]) {
  const cell = 4;
  const buckets = new Map<string, number[]>();
  for (const i of nodes) {
    const key = `${Math.floor(g.xs[i] / cell)},${Math.floor(g.ys[i] / cell)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
  }
  for (const i of nodes) {
    const bx = Math.floor(g.xs[i] / cell), by = Math.floor(g.ys[i] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
        if (j <= i) continue;
        if (Math.abs(g.xs[i] - g.xs[j]) <= 3 && Math.abs(g.ys[i] - g.ys[j]) <= 3) {
          g.adj[i].push({ to: j, m: 0 });
          g.adj[j].push({ to: i, m: 0 });
        }
      }
    }
  }
}

// The node nearest a point, among nodes that have any edges (and, if given,
// are in component `only`).
export function nearestNode(g: Graph, p: LngLat, comp?: Int32Array, only?: number): number {
  const [tx, ty] = lngLatToTile(p[0], p[1], g.z);
  const wx = tx * g.extent, wy = ty * g.extent;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.xs.length; i++) {
    if (!g.adj[i].length) continue;
    if (comp && comp[i] !== only) continue;
    const d = (g.xs[i] - wx) ** 2 + (g.ys[i] - wy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Connected components: comp[i] is node i's component, and the largest
// component's id is returned too.
export function components(g: Graph): { comp: Int32Array; largest: number } {
  const comp = new Int32Array(g.xs.length).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < g.xs.length; i++) {
    if (comp[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const u = stack.pop()!;
      n++;
      for (const { to } of g.adj[u]) if (comp[to] < 0) { comp[to] = id; stack.push(to); }
    }
    sizes.push(n);
  }
  let largest = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largest]) largest = i;
  return { comp, largest };
}

// The two nodes to route between: the nearest to each point, unless those
// aren't connected (one is on a stray bit of path, say); then the nearest on
// the largest connected network.
export function snapPair(g: Graph, a: LngLat, b: LngLat): [number, number] {
  const s = nearestNode(g, a), t = nearestNode(g, b);
  const { comp, largest } = components(g);
  if (comp[s] === comp[t]) return [s, t];
  return [nearestNode(g, a, comp, largest), nearestNode(g, b, comp, largest)];
}

// A* from s to t; the heuristic is the straight-line distance, in metres.
export function shortestPath(g: Graph, s: number, t: number): { path: number[]; metres: number } | null {
  const target = worldToLngLat(g, t);
  const h = (i: number) => haversine(worldToLngLat(g, i), target);
  const dist = new Float64Array(g.xs.length).fill(Infinity);
  const prev = new Int32Array(g.xs.length).fill(-1);
  const heap = new MinHeap();
  dist[s] = 0;
  heap.push(h(s), s);
  while (heap.size) {
    const [, u] = heap.pop();
    if (u === t) break;
    for (const { to, m } of g.adj[u]) {
      const d = dist[u] + m;
      if (d < dist[to]) {
        dist[to] = d;
        prev[to] = u;
        heap.push(d + h(to), to);
      }
    }
  }
  if (!isFinite(dist[t])) return null;
  const path = [t];
  while (path[path.length - 1] !== s) path.push(prev[path[path.length - 1]]);
  return { path: path.reverse(), metres: dist[t] };
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
