// A photo's EXIF (JPEG only): where and when it was taken, for a post's
// photo record (defs#photo's `at` and `takenAt`), and its EXIF block, kept
// when a photo has to be re-encoded to fit the lexicon's 2 MB. Photos of
// places are much of what's worth sharing, and that needs where they are.

export interface ExifInfo {
  // The APP1 segment (marker included), Orientation set to 1: a re-encoded
  // photo is drawn upright already.
  segment: Uint8Array | null;
  lat: number | null;
  lon: number | null;
  // When it was taken, as an ISO datetime; offsetKnown false when the camera
  // gave only local time, read in this browser's time zone.
  takenAt: string | null;
  offsetKnown: boolean;
}

const NONE: ExifInfo = { segment: null, lat: null, lon: null, takenAt: null, offsetKnown: false };

export function readExif(bytes: Uint8Array): ExifInfo {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return NONE;
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data: no more headers
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const segment = bytes.slice(p, p + 2 + len);
      try {
        return { segment, ...parse(segment, 10) };
      } catch {
        return { ...NONE, segment };
      }
    }
    p += 2 + len;
  }
  return NONE;
}

// The TIFF structure at segment[base...]: GPS position, time, and (patched
// in place) Orientation.
function parse(seg: Uint8Array, base: number): Omit<ExifInfo, 'segment'> {
  const v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  const ascii = (o: number, n: number) => String.fromCharCode(...seg.subarray(base + o, base + o + n)).replace(/\0.*$/, '');
  // Each entry of the IFD at off: tag -> [type, count, value offset (or
  // where the value is, if it fits in 4 bytes)].
  const ifd = (off: number) => {
    const out = new Map<number, [number, number, number]>();
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const type = u16(e + 2), count = u32(e + 4);
      const size = ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1) * count;
      out.set(u16(e), [type, count, size <= 4 ? e + 8 : u32(e + 8)]);
    }
    return out;
  };
  const str = (d: Map<number, [number, number, number]>, tag: number) => {
    const t = d.get(tag);
    return t ? ascii(t[2], t[1]) : null;
  };
  const rationals = (d: Map<number, [number, number, number]>, tag: number) => {
    const t = d.get(tag);
    if (!t || t[0] !== 5) return null;
    return Array.from({ length: t[1] }, (_, i) => u32(t[2] + i * 8) / (u32(t[2] + i * 8 + 4) || 1));
  };

  const ifd0 = ifd(u32(4));
  const orient = ifd0.get(0x0112);
  if (orient) v.setUint16(base + orient[2], 1, le);

  let lat: number | null = null, lon: number | null = null;
  const gpsPtr = ifd0.get(0x8825);
  let gpsTime: string | null = null;
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr[2]));
    const dms = (x: number[] | null) => (x && x.length >= 3 ? x[0] + x[1] / 60 + x[2] / 3600 : null);
    const la = dms(rationals(g, 2)), lo = dms(rationals(g, 4));
    if (la !== null && lo !== null && (la !== 0 || lo !== 0)) {
      lat = str(g, 1) === 'S' ? -la : la;
      lon = str(g, 3) === 'W' ? -lo : lo;
    }
    const d = str(g, 0x1d), t = rationals(g, 7);
    if (d && t && /^\d{4}:\d\d:\d\d$/.test(d)) {
      const ms = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), t[0], t[1], 0) + Math.round(t[2] * 1000);
      if (Number.isFinite(ms)) gpsTime = new Date(ms).toISOString();
    }
  }

  let takenAt: string | null = null, offsetKnown = false;
  const exifPtr = ifd0.get(0x8769);
  const e = exifPtr ? ifd(u32(exifPtr[2])) : null;
  const local = (e && str(e, 0x9003)) || str(ifd0, 0x0132);
  const m = local?.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (m) {
    const offset = e ? str(e, 0x9011) : null;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    if (offset && /^[+-]\d\d:\d\d$/.test(offset)) { takenAt = new Date(iso + offset).toISOString(); offsetKnown = true; }
    else if (gpsTime) { takenAt = gpsTime; offsetKnown = true; }
    else { const d = new Date(iso); if (Number.isFinite(d.getTime())) takenAt = d.toISOString(); }
  } else if (gpsTime) { takenAt = gpsTime; offsetKnown = true; }
  return { lat, lon, takenAt, offsetKnown };
}

// A JPEG made by a canvas with the original's EXIF segment put back, in
// place of the canvas's own JFIF header.
export function withExif(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  let p = 2;
  // Skip the canvas's APP0 (JFIF): EXIF takes its place.
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) p = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(2 + segment.length + jpeg.length - p);
  out.set([0xff, 0xd8], 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(p), 2 + segment.length);
  return out;
}
