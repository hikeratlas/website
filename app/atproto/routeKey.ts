// Route keys (hikeratlas/route-keys, recipe v1; website#130): a route's
// identity, computed from its line, so no ids are minted. A fave's record
// key, and the routeKey of tracks and reviews. The algorithm lives in the
// library only: never copy it here.
//
// The library (with h3-js) is loaded only when a key is made or read: most
// visitors never fave.
type Lib = typeof import('@hikeratlas/route-keys');
let libP: Promise<Lib> | null = null;
const lib = () => (libP ??= import('@hikeratlas/route-keys'));

export type Shape = 'b' | 'p' | 'w';
type Pt = [number, number]; // [lon, lat]

// A route's shape for its key, from the site's own words for it (the
// library's shapeFor, without loading it).
export const shapeFor = (s: string): Shape => (s === 'loop' ? 'p' : s === 'out-and-back' ? 'b' : 'w');

export async function routeKey(line: Pt[], shape: Shape): Promise<string> {
  return (await lib()).routeKey(line, shape);
}

// Many routes' keys at once (a park's), null for a line too short.
export async function routeKeys(routes: { line: Pt[]; shape: Shape }[]): Promise<(string | null)[]> {
  const { routeKey } = await lib();
  return routes.map((r) => { try { return routeKey(r.line, r.shape); } catch { return null; } });
}

// Where a key's route is, roughly: its centroid cell's centre, [lon, lat];
// null for anything that isn't a v1 key (e.g. a fave written by the spike).
export async function keyCentroid(key: string): Promise<Pt | null> {
  return (await lib()).centroidOf(key);
}
