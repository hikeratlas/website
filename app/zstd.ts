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
// path. Vite copies it into the build's assets and gives us its URL (?url).
import wasmUrl from "../node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm?url";

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

const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// The end offsets of the zstd frames in buf, or null if it isn't a sequence
// of whole frames.
//
// `pmtiles merge` builds a tile that several layer archives cover by joining
// their zstd frames, without recompressing them. libzstd decodes that to the
// joined tiles, which is the merged tile, but zstd-wasm's decompress() sizes
// its output from the first frame alone, and fails. So each frame is
// decompressed on its own.
export function zstdFrameEnds(buf: Uint8Array): number[] | null {
  const ends: number[] = [];
  let p = 0;
  while (p < buf.length) {
    if (p + 8 > buf.length) {
      return null;
    }
    const magic = u32(buf, p);
    p += 4;
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) {
      // a skippable frame: its size, then that many bytes
      p += 4 + u32(buf, p);
    } else if (magic === 0xfd2fb528) {
      const fhd = buf[p++];
      const singleSegment = (fhd >> 5) & 1;
      // window descriptor, dictionary ID, frame content size
      p += (singleSegment ? 0 : 1) + [0, 1, 2, 4][fhd & 3] + [singleSegment, 2, 4, 8][fhd >> 6];
      for (;;) {
        if (p + 3 > buf.length) {
          return null;
        }
        const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
        // an RLE block holds one byte; raw and compressed blocks, their size
        p += 3 + (((header >> 1) & 3) === 1 ? 1 : header >>> 3);
        if (header & 1) {
          break; // the frame's last block
        }
      }
      if ((fhd >> 2) & 1) {
        p += 4; // checksum
      }
    } else {
      return null;
    }
    ends.push(p);
  }
  return p === buf.length ? ends : null;
}

// Wraps pmtiles.js's own decompress function (which handles gzip and none) to
// also handle zstd.
export function withZstd(fallback: Decompress): Decompress {
  return async (buf, compression) => {
    if (compression !== ZSTD) {
      return fallback(buf, compression);
    }
    const m = await loadZstd();
    const bytes = new Uint8Array(buf);
    const opts = { defaultHeapSize: UNKNOWN_SIZE_CAPACITY };
    const ends = zstdFrameEnds(bytes);
    if (!ends || ends.length <= 1) {
      // One frame, or something libzstd can report the error for.
      const out = m.decompress(bytes, opts);
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    }
    const parts: Uint8Array[] = [];
    let start = 0;
    let length = 0;
    for (const end of ends) {
      const part = m.decompress(bytes.subarray(start, end), opts);
      parts.push(part);
      length += part.byteLength;
      start = end;
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out.buffer;
  };
}
