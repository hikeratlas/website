// An elevation profile from the Terrarium DEM tiles the map's hillshade
// already uses (elevation = R * 256 + G + B / 256 - 32768 metres).
import { haversine, lngLatToTile, type LngLat } from './graph';

const URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';
const DEM_Z = 14;
const tiles = new Map<string, Promise<Float32Array>>();

function demTile(x: number, y: number): Promise<Float32Array> {
  const key = `${x}/${y}`;
  if (!tiles.has(key)) {
    tiles.set(key, (async () => {
      const blob = await (await fetch(`${URL}/${DEM_Z}/${x}/${y}.png`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
      return out;
    })());
  }
  return tiles.get(key)!;
}

async function elevationAt(p: LngLat): Promise<number> {
  const [tx, ty] = lngLatToTile(p[0], p[1], DEM_Z);
  const fx = tx * 256 - 0.5, fy = ty * 256 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const px = async (X: number, Y: number) => (await demTile(Math.floor(X / 256), Math.floor(Y / 256)))[(Y & 255) * 256 + (X & 255)];
  const [a, b, c, d] = await Promise.all([px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1)]);
  const u = fx - x0, v = fy - y0;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
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
  return { points: samples.map(([d], i) => [d, elevations[i]]), gain, loss };
}
