// An elevation profile from the same DEM as the map's hillshade and contours
// (basemap#187): hikeratlas/nl-dem's 5 m tiles over Newfoundland, else
// Mapterhorn's (lidar where it exists). Both are 512 px Terrarium tiles
// (elevation = R * 256 + G + B / 256 - 32768 metres). Where a tile doesn't
// exist (Mapterhorn past its coverage, nl-dem past z13), a point is sampled
// from the nearest ancestor that does.
import { haversine, lngLatToTile, type LngLat } from './graph';
import { nlCovers, nlTile, NL_MAXZOOM, NL_MINZOOM } from '~/components/nlDem';

const MAPTERHORN = 'https://tiles.mapterhorn.com';
const DEM_Z = 14; // ~5 m pixels at 512 px: finer than the 10 m sampling step
const SIZE = 512;

interface Grid { z: number; x: number; y: number; h: Float32Array }

async function decode(data: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(data);
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
  return out;
}

// Decoded tiles, by source and z/x/y; null where the source has none.
const decoded = new Map<string, Promise<Float32Array | null>>();
function cached(key: string, load: () => Promise<Float32Array | null>): Promise<Float32Array | null> {
  let got = decoded.get(key);
  if (!got) {
    got = load();
    got.catch(() => decoded.delete(key));
    decoded.set(key, got);
  }
  return got;
}

function fromNl(z: number, x: number, y: number) {
  return cached(`nl/${z}/${x}/${y}`, async () => {
    try {
      const t = await nlTile(z, x, y);
      return t ? decode(new Blob([t.data], { type: 'image/webp' })) : null;
    } catch (e) {
      console.warn('nl-dem lookup failed; using Mapterhorn', e);
      return null;
    }
  });
}

function fromMapterhorn(z: number, x: number, y: number) {
  return cached(`mt/${z}/${x}/${y}`, async () => {
    const r = await fetch(`${MAPTERHORN}/${z}/${x}/${y}.webp`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Mapterhorn ${r.status} for ${z}/${x}/${y}`);
    return decode(await r.blob());
  });
}

// The grid for a DEM_Z tile: nl-dem's (its z13 ancestor) where it has one,
// as Mapterhorn's z14+ there is blurrier; else Mapterhorn's own tile, or its
// nearest ancestor past Mapterhorn's coverage.
const grids = new Map<string, Promise<Grid>>();
function demGrid(x: number, y: number): Promise<Grid> {
  const key = `${x}/${y}`;
  if (!grids.has(key)) {
    grids.set(key, (async () => {
      const nz = Math.min(DEM_Z, NL_MAXZOOM);
      const s = DEM_Z - nz;
      if (nz >= NL_MINZOOM && nlCovers(nz, x >> s, y >> s)) {
        const h = await fromNl(nz, x >> s, y >> s);
        if (h) return { z: nz, x: x >> s, y: y >> s, h };
      }
      for (let z = DEM_Z; z >= 0; z--) {
        const s = DEM_Z - z;
        const h = await fromMapterhorn(z, x >> s, y >> s);
        if (h) return { z, x: x >> s, y: y >> s, h };
      }
      throw new Error(`no DEM tile for ${DEM_Z}/${x}/${y}`);
    })());
  }
  return grids.get(key)!;
}

async function elevationAt(p: LngLat): Promise<number> {
  const [tx, ty] = lngLatToTile(p[0], p[1], DEM_Z);
  const g = await demGrid(Math.floor(tx), Math.floor(ty));
  const scale = 2 ** (DEM_Z - g.z);
  // Pixel coordinates within the grid's tile, between pixel centres.
  const fx = (tx / scale - g.x) * SIZE - 0.5, fy = (ty / scale - g.y) * SIZE - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const at = (X: number, Y: number) => g.h[Math.min(SIZE - 1, Math.max(0, Y)) * SIZE + Math.min(SIZE - 1, Math.max(0, X))];
  const u = fx - x0, v = fy - y0;
  return (at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - v) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * v;
}

// Points every `step` metres along a line, with their distance from its start.
function resample(coords: LngLat[], step: number): [number, LngLat][] {
  const out: [number, LngLat][] = [[0, coords[0]]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const d = haversine(a, b);
    while (d > 0 && out[out.length - 1][0] + step <= acc + d) {
      const t = (out[out.length - 1][0] + step - acc) / d;
      out.push([out[out.length - 1][0] + step, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]]);
    }
    acc += d;
  }
  out.push([acc, coords[coords.length - 1]]);
  return out;
}

export interface Profile {
  points: [number, number][]; // [metres along, elevation]
  coords: LngLat[];           // where each point is
  gain: number;
  loss: number;
}

// Climbs and descents count only once they exceed `threshold` metres, so the
// DEM's noise (it wobbles around the true ground) doesn't add phantom climb.
export async function profile(coords: LngLat[], step = 10, threshold = 10): Promise<Profile> {
  const samples = resample(coords, step);
  const elevations = await Promise.all(samples.map(([, p]) => elevationAt(p)));
  let gain = 0, loss = 0, ref = elevations[0];
  for (const e of elevations) {
    if (e - ref >= threshold) { gain += e - ref; ref = e; }
    else if (ref - e >= threshold) { loss += ref - e; ref = e; }
  }
  return { points: samples.map(([d], i) => [d, elevations[i]]), coords: samples.map(([, p]) => p), gain, loss };
}
