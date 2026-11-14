// Route keys, recipe v1 (website#130): a route's identity, computed from its
// line, so no ids are minted. A fave's record key, and the routeKey of tracks
// and reviews. lexicons/route_key.py is the reference implementation; this
// must agree with it to the character (lexicons/route_key_vectors.json,
// checked by routeKey.test.ts). Floating point in the same order as there:
// plain sums, and sqrt rather than hypot.
//
// h3-js is loaded only when a key is made or read: most visitors never fave.
type H3 = typeof import('h3-js');
let h3P: Promise<H3> | null = null;
const h3 = () => (h3P ??= import('h3-js'));

export type Shape = 'b' | 'p' | 'w';
type Pt = [number, number]; // [lon, lat]

const RES = 10;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// A route's shape for its key, from the site's own words for it.
export const shapeFor = (s: string): Shape => (s === 'loop' ? 'p' : s === 'out-and-back' ? 'b' : 'w');

function metres(a: Pt, b: Pt): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (a[0] - b[0]) * k;
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}

function along(line: Pt[], frac: number, segs: number[], total: number): Pt {
  const goal = total * frac;
  let run = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (run + s >= goal && s > 0) {
      const t = (goal - run) / s;
      const a = line[i], b = line[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    run += s;
  }
  return line[line.length - 1];
}

const zigzag = (v: number) => (v >= 0 ? 2 * v : -2 * v - 1);

// Made synchronously once h3-js is loaded (routeKeys below), for many routes.
function keyWith(H: H3, line: Pt[], shape: Shape): string {
  if (line.length < 2) throw new Error('a line needs two points');
  const segs: number[] = [];
  for (let i = 0; i + 1 < line.length; i++) segs.push(metres(line[i], line[i + 1]));
  let total = 0;
  for (const s of segs) total += s;
  if (total === 0) total = 1;
  let sx = 0, sy = 0;
  for (let i = 0; i < 21; i++) {
    const q = along(line, i / 20, segs, total);
    sx += q[0]; sy += q[1];
  }
  const cell = (p: Pt) => H.latLngToCell(p[1], p[0], RES);
  const c = cell([sx / 21, sy / 21]);
  // Base cell and 10 digits: 37 bits, left-aligned in 42 (7 characters).
  const n = BigInt(`0x${c}`);
  let v = (n >> 45n) & 0x7fn;
  for (let r = 1; r <= RES; r++) v = (v << 3n) | ((n >> BigInt((15 - r) * 3)) & 7n);
  v <<= 5n;
  let out = '1';
  for (let k = 0; k < 7; k++) out += ABC[Number((v >> BigInt(6 * (6 - k))) & 63n)];
  out += shape;
  const o = H.cellToLocalIj(c, c);
  const seen = new Set<string>();
  const offs: [number, number][] = [];
  for (let k = 0; k < 9; k++) {
    const ij = H.cellToLocalIj(c, cell(along(line, k / 8, segs, total)));
    const off: [number, number] = [ij.i - o.i, ij.j - o.j];
    if (!seen.has(`${off}`)) { seen.add(`${off}`); offs.push(off); }
  }
  offs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const off of offs) {
    for (let z of off.map(zigzag)) {
      for (;;) {
        const d = z & 31;
        z = Math.floor(z / 32);
        out += ABC[d | (z ? 32 : 0)];
        if (!z) break;
      }
    }
  }
  return out;
}

export async function routeKey(line: Pt[], shape: Shape): Promise<string> {
  return keyWith(await h3(), line, shape);
}

// Many routes' keys at once (a park's), null for a line too short.
export async function routeKeys(routes: { line: Pt[]; shape: Shape }[]): Promise<(string | null)[]> {
  const H = await h3();
  return routes.map((r) => { try { return keyWith(H, r.line, r.shape); } catch { return null; } });
}

// Where a key's route is, roughly: its centroid cell's centre, [lon, lat];
// null for anything that isn't a v1 key (e.g. a fave written by the spike).
export async function keyCentroid(key: string): Promise<Pt | null> {
  if (key.length < 9 || key[0] !== '1' || !'bpw'.includes(key[8])) return null;
  let v = 0n;
  for (const ch of key.slice(1, 8)) {
    const d = ABC.indexOf(ch);
    if (d < 0) return null;
    v = (v << 6n) | BigInt(d);
  }
  if (v & 31n) return null;
  v >>= 5n;
  let n = (1n << 59n) | (BigInt(RES) << 52n) | ((v >> 30n) << 45n);
  for (let r = 1; r <= 15; r++) {
    const d = r <= RES ? (v >> BigInt(3 * (RES - r))) & 7n : 7n;
    n |= d << BigInt((15 - r) * 3);
  }
  const H = await h3();
  const c = n.toString(16);
  if (!H.isValidCell(c)) return null;
  const [lat, lon] = H.cellToLatLng(c);
  return [lon, lat];
}

