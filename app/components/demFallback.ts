// Mapterhorn (https://mapterhorn.com/) serves Terrarium DEM tiles as deep as
// its sources go: z16 on US lidar, z15 on Canadian lidar, but only z12 where
// it has just the global 30 m data (e.g. Banff, Yoho, Kananaskis). Deeper
// tiles 404 there. MapLibre's hillshade falls back to the parent tile on its
// own; maplibre-contour doesn't, so a 404 would leave a hole in the contours.
//
// demFallbackWorker() runs inside maplibre-contour's worker (see
// withDemFallback) and wraps its fetch: a 404 from Mapterhorn is answered with
// the nearest ancestor tile's quadrant, upsampled to the same 512 px size so it
// stitches with full-resolution neighbours. Heights are interpolated in metres,
// not on the encoded RGB, and re-encoded as a Terrarium PNG.
//
// With `nl` given, it first tries hikeratlas/nl-dem's archive of
// Newfoundland's 5 m DEM (see nlDem.ts): at nl.minzoom-nl.maxzoom its tile if
// it has one, and deeper, its maxzoom tile's quadrants, upsampled the same way.
//
// The function is stringified into the worker, so it must not refer to
// anything outside itself.
export interface NlDemConfig { archive: string; pmtilesJs: string; minzoom: number; maxzoom: number }

export function demFallbackWorker(nl?: NlDemConfig) {
  const realFetch = self.fetch.bind(self);
  const TILE = /^https:\/\/tiles\.mapterhorn\.com\/(\d+)\/(\d+)\/(\d+)\.webp$/;
  type Heights = { size: number; h: Float32Array };
  // Decoded ancestors, shared by sibling tiles that fall back to them.
  const cache = new Map<string, Promise<Heights | null>>();

  async function decode(blob: Blob): Promise<Heights> {
    const bmp = await createImageBitmap(blob);
    const size = bmp.width;
    const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const px = ctx.getImageData(0, 0, size, size).data;
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) {
      h[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
    }
    return { size, h };
  }

  // The (qx, qy) quadrant of a tile's heights, bilinearly upsampled 2x.
  function quadrant(p: Heights, qx: number, qy: number): Heights {
    const n = p.size;
    const h = new Float32Array(n * n);
    const at = (x: number, y: number) =>
      p.h[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
    for (let j = 0; j < n; j++) {
      const sy = (qy * n + j + 0.5) / 2 - 0.5;
      const y0 = Math.floor(sy), fy = sy - y0;
      for (let i = 0; i < n; i++) {
        const sx = (qx * n + i + 0.5) / 2 - 0.5;
        const x0 = Math.floor(sx), fx = sx - x0;
        h[j * n + i] =
          (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
          (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      }
    }
    return { size: n, h };
  }

  // A tile's heights, from its nearest ancestor if it 404s.
  function heights(z: number, x: number, y: number, signal?: AbortSignal | null): Promise<Heights | null> {
    const key = `${z}/${x}/${y}`;
    let got = cache.get(key);
    if (!got) {
      got = (async () => {
        const r = await realFetch(`https://tiles.mapterhorn.com/${key}.webp`, { signal });
        if (r.status === 404 && z > 0) {
          const parent = await heights(z - 1, x >> 1, y >> 1, signal);
          return parent && quadrant(parent, x & 1, y & 1);
        }
        return r.ok ? decode(await r.blob()) : null;
      })();
      got.catch(() => cache.delete(key));
      cache.set(key, got);
      while (cache.size > 32) cache.delete(cache.keys().next().value!);
    }
    return got;
  }

  async function encode(t: Heights): Promise<Blob> {
    const canvas = new OffscreenCanvas(t.size, t.size);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(t.size, t.size);
    for (let i = 0; i < t.h.length; i++) {
      const v = t.h[i] + 32768;
      img.data[4 * i] = Math.floor(v / 256);
      img.data[4 * i + 1] = Math.floor(v) % 256;
      img.data[4 * i + 2] = Math.floor((v - Math.floor(v)) * 256);
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  // nl-dem, through pmtiles.js loaded into this worker.
  type Archive = { getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined> };
  let archive: Archive | undefined;
  if (nl) {
    try {
      (self as unknown as { importScripts(u: string): void }).importScripts(nl.pmtilesJs);
      const P = (self as unknown as { pmtiles: { PMTiles: new (u: string) => Archive } }).pmtiles;
      archive = new P.PMTiles(nl.archive);
    } catch (e) {
      console.warn('nl-dem unavailable in the contour worker', e);
    }
  }
  const nlDecoded = new Map<string, Promise<Heights | null>>();
  // nl-dem's heights for a tile deeper than its maxzoom, from that ancestor.
  function nlHeights(z: number, x: number, y: number, signal?: AbortSignal | null): Promise<Heights | null> {
    const key = `${z}/${x}/${y}`;
    let got = nlDecoded.get(key);
    if (!got) {
      got = (async () => {
        if (z > nl!.maxzoom) {
          const parent = await nlHeights(z - 1, x >> 1, y >> 1, signal);
          return parent && quadrant(parent, x & 1, y & 1);
        }
        const t = await archive!.getZxy(z, x, y, signal ?? undefined);
        return t ? decode(new Blob([t.data], { type: 'image/webp' })) : null;
      })();
      got.catch(() => nlDecoded.delete(key));
      nlDecoded.set(key, got);
      while (nlDecoded.size > 16) nlDecoded.delete(nlDecoded.keys().next().value!);
    }
    return got;
  }
  async function fromNl(z: number, x: number, y: number, signal?: AbortSignal | null): Promise<Response | null> {
    if (!archive || !nl || z < nl.minzoom) return null;
    try {
      if (z <= nl.maxzoom) {
        const t = await archive.getZxy(z, x, y, signal ?? undefined);
        return t ? new Response(t.data, { status: 200, headers: { 'Content-Type': 'image/webp' } }) : null;
      }
      const s = z - nl.maxzoom;
      if (!(await archive.getZxy(nl.maxzoom, x >> s, y >> s, signal ?? undefined))) return null;
      const h = await nlHeights(z, x, y, signal);
      return h && new Response(await encode(h), { status: 200, headers: { 'Content-Type': 'image/png' } });
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('nl-dem lookup failed; using Mapterhorn', e);
      return null;
    }
  }

  self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = TILE.exec(url);
    if (m) {
      const fromArchive = await fromNl(+m[1], +m[2], +m[3], init?.signal);
      if (fromArchive) return fromArchive;
    }
    const r = await realFetch(input, init);
    if (!m || r.status !== 404) return r;
    const [z, x, y] = [+m[1], +m[2], +m[3]];
    if (z === 0) return r;
    const parent = await heights(z - 1, x >> 1, y >> 1, init?.signal);
    if (!parent) return r;
    return new Response(await encode(quadrant(parent, x & 1, y & 1)), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };
}

// Point maplibre-contour at a worker that installs demFallbackWorker() and then
// loads maplibre-contour's own worker bundle.
export function withDemFallback(mlcontour: { workerUrl: string }, nl?: NlDemConfig) {
  if (typeof window === 'undefined' || !mlcontour.workerUrl) return;
  const inner = mlcontour.workerUrl;
  const src = `(${demFallbackWorker.toString()})(${nl ? JSON.stringify(nl) : ''});\nimportScripts(${JSON.stringify(inner)});\n`;
  mlcontour.workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}
