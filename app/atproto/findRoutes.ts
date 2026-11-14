// Which curated hikes route keys are (for faves, and later tracks and
// reviews), from the keys alone. A key's first part is its route's centroid
// cell: the parks whose hikes' box holds it are loaded, their hikes' keys
// made, and matched exactly. A key no current hike has is a route that has
// left curation (or moved: website#130's re-matching, and its route archive,
// aren't built yet).
import { type BundleIndex, type ParkDoc, hikeEntries, indexUrl, loadRegions, parkDoc } from '~/hikes';
import { keyCentroid, routeKeys, shapeFor, type Shape } from './routeKey';

export interface Found { title: string; park: string; href: string | null }

// Every curated route in a park's document, by the ids hikeEntries gives.
function parkRoutes(doc: ParkDoc): Map<string, { line: [number, number][]; shape: Shape }> {
  const p = String(doc.park?.id ?? '');
  const out = new Map<string, { line: [number, number][]; shape: Shape }>();
  doc.day_hikes?.forEach((h, i) => out.set(`${p}/day/${i}`, { line: h.route.line, shape: shapeFor(h.kind) }));
  doc.stops?.forEach((h, i) => out.set(`${p}/stop/${i}`, { line: h.route.line, shape: 'b' }));
  doc.base_camps?.forEach((b, i) => {
    out.set(`${p}/base/${i}`, { line: b.approach.line, shape: 'w' });
    b.hikes?.forEach((h, j) => out.set(`${p}/base/${i}/${j}`, { line: h.route.line, shape: shapeFor(h.kind) }));
  });
  doc.point_to_points?.forEach((t, i) => out.set(`${p}/multi/${i}`, { line: t.route.line, shape: shapeFor(t.kind) }));
  return out;
}

const MAX_PARKS = 60;
const MARGIN = 0.01; // degrees, around a park's hikes' box

export async function findRoutes(build: string, keys: string[]): Promise<Map<string, Found>> {
  const found = new Map<string, Found>();
  if (!keys.length) return found;
  const [regions, index] = await Promise.all([
    loadRegions(build),
    fetch(indexUrl(build)).then((r) => (r.ok ? r.json() as Promise<BundleIndex> : null)).catch(() => null),
  ]);
  if (!regions || !index) return found;
  const areas = regions.countries.flatMap((c) => c.states.flatMap((s) => s.areas));
  const want = new Set(keys);
  // The parks around each key's centroid; a park's ids sharing one document
  // (one park under two OSM ids) are loaded once.
  const parks = new Map<string, string>(); // document's [offset] -> park id
  for (const c of await Promise.all(keys.map(keyCentroid))) {
    if (!c) continue;
    for (const a of areas) {
      const b = a.bbox;
      if (!b || c[0] < b[0] - MARGIN || c[0] > b[2] + MARGIN || c[1] < b[1] - MARGIN || c[1] > b[3] + MARGIN) continue;
      for (const id of a.ids?.length ? a.ids : [a.id]) {
        const at = index.parks[id];
        if (at && !parks.has(`${at[0]}`)) parks.set(`${at[0]}`, id);
      }
    }
  }
  const ids = [...parks.values()].slice(0, MAX_PARKS);
  // A few at a time: each is a range request on the bundle.
  for (let i = 0; i < ids.length; i += 6) {
    const docs = await Promise.all(ids.slice(i, i + 6).map((id) => parkDoc(build, index, id).catch(() => null)));
    for (const doc of docs) {
      if (!doc) continue;
      const routes = parkRoutes(doc);
      const entries = hikeEntries(doc).filter((e) => (routes.get(e.id)?.line.length ?? 0) >= 2);
      const ks = await routeKeys(entries.map((e) => routes.get(e.id)!));
      const park = String(doc.park?.id ?? '');
      const path = index.paths?.[park];
      for (const [j, e] of entries.entries()) {
        const k = ks[j];
        if (!k || !want.has(k) || found.has(k)) continue;
        found.set(k, { title: e.title, park: doc.park?.name ?? '', href: path ? `/hikes/${path}/${e.slug}` : null });
      }
    }
    if (keys.every((k) => found.has(k))) break;
  }
  return found;
}
