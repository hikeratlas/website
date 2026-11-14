// GPX traces for tracks (com.hikeratlas.temp.track): read in the browser,
// packaged into one file per outing (a multi-day trip recorded in several
// files is one GPX, a <trk> per file, in time order), measured, and
// gzipped for upload (the lexicon prefers gzip; a PDS may sniff plain GPX
// as XML or text, but keeps a gzip's type).

const NS = 'http://www.topografix.com/GPX/1/1';

export interface TrackPoint { lon: number; lat: number; ele: number | null; time: number | null }

export interface GpxStats {
  // When the first point was, and seconds from it to the last (for a
  // multi-day trip, nights included); null without times.
  startedAt: string | null;
  duration: number | null;
  distance: number; // metres
  gain: number | null; // metres climbed; null without elevations
  points: number;
}

function parse(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx')
    throw new Error('Not a GPX file');
  return doc;
}

const byName = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name));

function pointsOf(el: Element | Document): TrackPoint[] {
  return byName(el, 'trkpt').map((p) => {
    const ele = byName(p, 'ele')[0]?.textContent;
    const time = byName(p, 'time')[0]?.textContent;
    const t = time ? Date.parse(time) : NaN;
    return {
      lon: Number(p.getAttribute('lon')), lat: Number(p.getAttribute('lat')),
      ele: ele != null && ele.trim() !== '' && Number.isFinite(Number(ele)) ? Number(ele) : null,
      time: Number.isFinite(t) ? t : null,
    };
  }).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

// One GPX for the outing from its files: each file's tracks, in the order
// they start (files without times keep the order given). A route-only file
// (<rte>, as some apps export) becomes a track.
export function combine(texts: string[]): string {
  const tracks: { start: number; i: number; el: Element }[] = [];
  texts.forEach((text, i) => {
    const doc = parse(text);
    let els = byName(doc, 'trk');
    if (!els.length) {
      els = byName(doc, 'rte').map((r) => {
        const trk = doc.createElementNS(NS, 'trk');
        const seg = doc.createElementNS(NS, 'trkseg');
        for (const p of byName(r, 'rtept')) {
          const q = doc.createElementNS(NS, 'trkpt');
          for (const a of ['lat', 'lon']) q.setAttribute(a, p.getAttribute(a) ?? '');
          for (const c of Array.from(p.children)) q.appendChild(c.cloneNode(true));
          seg.appendChild(q);
        }
        trk.appendChild(seg);
        return trk;
      });
    }
    for (const el of els) {
      const first = pointsOf(el).find((p) => p.time !== null);
      tracks.push({ start: first?.time ?? Infinity, i, el });
    }
  });
  if (!tracks.some((t) => pointsOf(t.el).length)) throw new Error('No track points in the GPX');
  tracks.sort((a, b) => (a.start - b.start) || (a.i - b.i));
  const out = document.implementation.createDocument(NS, 'gpx', null);
  const gpx = out.documentElement;
  gpx.setAttribute('version', '1.1');
  gpx.setAttribute('creator', 'Hiker Atlas');
  for (const t of tracks) gpx.appendChild(out.importNode(t.el, true));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out);
}

function metres(a: TrackPoint, b: TrackPoint): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Climbs under this many metres are GPS and barometer noise.
const GAIN_STEP = 5;

// Its distance, climb and times. Each <trkseg> is measured on its own: the
// gap between two (a pause, a night, the drive between two days) isn't
// walked.
export function stats(text: string): GpxStats {
  const doc = parse(text);
  const segs = byName(doc, 'trkseg').map(pointsOf).filter((s) => s.length);
  let distance = 0, gain = 0, anyEle = false;
  for (const s of segs) {
    let base: number | null = null;
    for (let i = 0; i < s.length; i++) {
      if (i) distance += metres(s[i - 1], s[i]);
      const e = s[i].ele;
      if (e === null) continue;
      anyEle = true;
      // Hysteresis: count a climb only once it's GAIN_STEP above the last
      // low point.
      if (base === null || e < base) base = e;
      else if (e - base >= GAIN_STEP) { gain += e - base; base = e; }
    }
  }
  const times = segs.flat().map((p) => p.time).filter((t): t is number => t !== null);
  const first = times.length ? Math.min(...times) : null;
  const last = times.length ? Math.max(...times) : null;
  return {
    startedAt: first !== null ? new Date(first).toISOString() : null,
    duration: first !== null && last !== null ? Math.round((last - first) / 1000) : null,
    distance: Math.round(distance),
    gain: anyEle ? Math.round(gain) : null,
    points: segs.reduce((n, s) => n + s.length, 0),
  };
}

// Its line, for drawing: each segment's [lon, lat]s, thinned to about n
// points in all.
export function lines(text: string, n = 400): [number, number][][] {
  const segs = byName(parse(text), 'trkseg').map(pointsOf).filter((s) => s.length);
  const total = segs.reduce((k, s) => k + s.length, 0);
  const step = Math.max(1, Math.floor(total / n));
  return segs.map((s) => s.filter((_, i) => i % step === 0 || i === s.length - 1).map((p) => [p.lon, p.lat]));
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const gzip = (text: string) => pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));

// A track's GPX blob as text, whichever way it was stored: plain, gzip or
// zstd (by its mimeType, else its first bytes).
export async function readBlob(bytes: Uint8Array, mimeType = ''): Promise<string> {
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const zst = bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
  if (mimeType === 'application/gzip' || gz) return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
  if (mimeType === 'application/zstd' || zst) {
    // The map's zstd decoder (4: pmtiles.js's Compression.Zstd).
    const { withZstd } = await import('~/zstd');
    const decode = withZstd(async () => { throw new Error('Not zstd'); });
    return new TextDecoder().decode(await decode(bytes.slice().buffer, 4));
  }
  return new TextDecoder().decode(bytes);
}
