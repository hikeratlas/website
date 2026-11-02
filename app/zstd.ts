// zstd support for pmtiles.js.
//
// The basemap's tiles may be zstd-compressed (hikeratlas/basemap builds them
// with tilemaker's "compress": "zstd" and `pmtiles merge --tile-compression=zstd`).
// pmtiles.js only decodes gzip itself, and browsers can't decode zstd with
// DecompressionStream yet, so zstd tiles go through a WASM build of
// Facebook's libzstd (@bokuweb/zstd-wasm, ~250KB).
//
// The WASM is only fetched once the map meets a zstd tile.

// The package's `exports` doesn't list the .wasm file, so it's imported by
// path. Remix's compiler copies it into public/build and gives us its URL.
import wasmUrl from "../node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm";

// pmtiles.js's Compression enum
const ZSTD = 4;

export type Decompress = (buf: ArrayBuffer, compression: number) => Promise<ArrayBuffer>;

type ZstdModule = typeof import("@bokuweb/zstd-wasm");

let zstd: Promise<ZstdModule> | null = null;

function loadZstd(): Promise<ZstdModule> {
  if (!zstd) {
    zstd = import("@bokuweb/zstd-wasm").then(async (m) => {
      // TypeScript picks up the package's Node types, whose init() takes no
      // path; the browser build's does.
      await (m.init as (path?: string) => Promise<void>)(wasmUrl);
      return m;
    });
    // Let a later tile try again, e.g. after a network blip.
    zstd.catch(() => {
      zstd = null;
    });
  }
  return zstd;
}

// Our tiles record their decompressed size, so this is only used if one
// doesn't. libzstd fails, rather than truncating, if it's too small.
const UNKNOWN_SIZE_CAPACITY = 16 * 1024 * 1024;

// Wraps pmtiles.js's own decompress function (which handles gzip and none) to
// also handle zstd.
export function withZstd(fallback: Decompress): Decompress {
  return async (buf, compression) => {
    if (compression !== ZSTD) {
      return fallback(buf, compression);
    }
    const m = await loadZstd();
    const out = m.decompress(new Uint8Array(buf), { defaultHeapSize: UNKNOWN_SIZE_CAPACITY });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  };
}
