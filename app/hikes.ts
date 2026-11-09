// URLs for parks and curated hikes (#55, #56):
//   /hikes, /hikes/<country>, /hikes/<country>/<state>,
//   /hikes/<country>/<state>/<park>, /hikes/<country>/<state>/<park>/<hike>
// and a day hike from a base camp: .../<park>/<camp>/<hike>.
//
// Country, state and park slugs come from hikeratlas/basemap's
// bin/hike-paths.py: routes/<build>/regions.json lists them all, and the
// routes index maps each park id to its path. Hike slugs are made here, from
// the park's routes, which the website loads anyway; they're regenerated
// each build, with no redirect history: an unknown hike slug goes to a close
// match in the park, else the park (see findHike).
import { TILES_ROOT } from '~/build';

export interface Area { slug: string; id: string; ids: string[]; name: string; hikes: number; bbox: Bbox | null }
export interface State { slug: string; name: string; hikes: number; parks: number; bbox: Bbox | null; areas: Area[] }
export interface Country { slug: string; name: string; hikes: number; parks: number; bbox: Bbox | null; states: State[] }
export interface Regions { countries: Country[] }
export type Bbox = [number, number, number, number];

export interface Crumb { name: string; path: string }

// A park's routes document, from hikeratlas/routes (curate.rs' to_json and
// main.rs): the parts the website reads.

// A route's line and what's along it (curate.rs' eval_json).
export interface Route {
  km: number;
  // Missing in builds from before it.
  one_way_km?: number;
  gain: number;
  loss: number;
  max_ele: number;
  // Hardest SAC grade along it (hikeratlas/routes): 4 is a scramble (#45).
  // 0 or missing: ungraded, or a build from before grades.
  max_sac?: number;
  // [landcover, share of the route]
  landcover: [string, number][];
  // [kind, names]: the passes, peaks, lakes... it goes by.
  passes: [string, string[]][];
  // Campsites along it, at km from its start.
  stopovers: { name: string; km: number; at: [number, number] }[];
  via: string[];
  line: [number, number][];
}

// A day hike, a day hike from a base camp, or a stop (curate.rs' cand_json).
// A route that follows an OSM hiking route carries its name (recall.rs).
export interface Hike {
  from: string;
  dest: string;
  kind: string;
  name?: string | null;
  // The score's parts: [name, points].
  why?: [string, number][];
  route: Route;
}

// A stop (hikeratlas/routes#70): a short walk to a sight from where the car
// is.
export type Stop = Hike;

export interface BaseCamp {
  camp: string;
  from: string;
  // The walk in.
  approach: Route;
  hikes: Hike[];
}

// A multi-day trip, end to end.
export interface PointToPoint {
  from: string;
  to: string;
  kind: string;
  name?: string | null;
  route: Route;
}

// The park (hikeratlas/routes' park): website and operator only when it has
// them (#72).
export interface Park { id: string; name: string; website?: string; operator?: string }

// A multi-day trip of a smaller park inside a park, which the park lists
// too (hikeratlas/routes' see_also): id is the trip's in its own park.
export interface SeeAlso {
  id: string; park: string; park_name: string;
  name: string | null; from: string; to: string; kind: string; km: number; gain: number;
}

export interface ParkDoc {
  park?: Park;
  day_hikes: Hike[];
  // Missing in builds from before stops.
  stops?: Stop[];
  base_camps: BaseCamp[];
  point_to_points: PointToPoint[];
  see_also?: SeeAlso[];
}

// A build's index of the parks' routes in its bundle (index.json).
export interface BundleIndex {
  bundle: string;
  // park osm id -> [offset, length] of its gzipped JSON in the bundle.
  parks: Record<string, [number, number]>;
  // From hikeratlas/basemap's bin/hike-paths.py, in builds that have it:
  // park id -> "<country>/<state>/<park>", and country or state path -> name.
  paths?: Record<string, string>;
  regions?: Record<string, string>;
}

// Lowercase ASCII words joined by hyphens, as bin/hike-paths.py makes them.
export function slugify(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A curated hike in a park's routes: its route id (as CuratedRoutes' lookup
// takes), title (as it shows it) and slug, "<camp>/<hike>" for a day hike
// from a base camp.
export interface HikeEntry { id: string; title: string; slug: string; km: number; gain: number; type: string }

function named(r: { name?: string | null }, otherwise: string): string {
  return typeof r.name === 'string' && r.name ? r.name : otherwise;
}

// Every hike in a park's routes document, with its slug. A day hike titled
// "<dest> from <start>" is slugged by its destination alone where no other
// hike in the park goes there or has that name ("cavell-meadows", not
// "cavell-meadows-from-mount-edith-cavell"). Repeats get -2, -3, ... in order.
export function hikeEntries(doc: ParkDoc): HikeEntry[] {
  const park = String(doc.park?.id ?? '');
  const days: Hike[] = doc.day_hikes ?? [];
  const camps: BaseCamp[] = doc.base_camps ?? [];
  const multis: PointToPoint[] = doc.point_to_points ?? [];
  const seen = new Map<string, number>();
  const count = (s: string) => seen.set(s.toLowerCase(), (seen.get(s.toLowerCase()) ?? 0) + 1);
  for (const h of days) { count(h.dest); if (h.name) count(h.name); }
  for (const b of camps) count(b.camp);
  for (const t of multis) count(named(t, `${t.from} to ${t.to}`));
  const unique = (s: string) => (seen.get(s.toLowerCase()) ?? 0) === 1;

  const used = new Map<string, number>();
  const claim = (base: string) => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const out: HikeEntry[] = [];
  days.forEach((h, i) => {
    const title = named(h, `${h.dest} from ${h.from}`);
    const short = !h.name && unique(h.dest) ? h.dest : title;
    out.push({ id: `${park}/day/${i}`, title, slug: claim(slugify(short) || 'hike'), km: h.route.km, gain: h.route.gain, type: 'Day hike' });
  });
  // Stops (hikeratlas/routes#70): slugged by the sight, after the day hikes,
  // so a day hike to the same place keeps the plain slug.
  ((doc.stops ?? []) as Stop[]).forEach((h, i) => {
    out.push({ id: `${park}/stop/${i}`, title: h.dest, slug: claim(slugify(h.dest) || 'stop'), km: h.route.km, gain: h.route.gain, type: 'Stop' });
  });
  camps.forEach((b, i) => {
    const camp = claim(slugify(b.camp) || 'camp');
    out.push({ id: `${park}/base/${i}`, title: b.camp, slug: camp, km: b.approach.km, gain: b.approach.gain, type: 'Base camp' });
    const inCamp = new Map<string, number>();
    const local = (base: string) => { const n = (inCamp.get(base) ?? 0) + 1; inCamp.set(base, n); return n === 1 ? base : `${base}-${n}`; };
    (b.hikes ?? []).forEach((h, j) => {
      out.push({
        id: `${park}/base/${i}/${j}`, title: named(h, `${h.dest} from ${b.camp}`),
        slug: `${camp}/${local(slugify(named(h, h.dest)) || 'hike')}`, km: h.route.km, gain: h.route.gain, type: 'Day hike from camp',
      });
    });
  });
  multis.forEach((t, i) => {
    const title = named(t, `${t.from} to ${t.to}`);
    out.push({ id: `${park}/multi/${i}`, title, slug: claim(slugify(title) || 'hike'), km: t.route.km, gain: t.route.gain, type: 'Multi-day' });
  });
  return out;
}

// The hike a slug names, or a close one: a slug that begins with it, or that
// it begins with, at a word break. Hikes are renamed by shortening
// ("skyline-trail-from-skyline-trail" became "skyline-trail"), so an old
// link usually finds its hike this way. exact says whether it was the slug.
export function findHike(entries: HikeEntry[], slug: string): { entry: HikeEntry; exact: boolean } | null {
  const exact = entries.find((e) => e.slug === slug);
  if (exact) return { entry: exact, exact: true };
  const depth = slug.split('/').length;
  const same = entries.filter((e) => e.slug.split('/').length === depth);
  const longer = same.filter((e) => slug.startsWith(`${e.slug}-`)).sort((a, b) => b.slug.length - a.slug.length);
  const shorter = same.filter((e) => e.slug.startsWith(`${slug}-`)).sort((a, b) => a.slug.length - b.slug.length);
  const e = longer[0] ?? shorter[0];
  return e ? { entry: e, exact: false } : null;
}

export function regionsUrl(build: string): string {
  return `${TILES_ROOT}/routes/${build}/regions.json`;
}

export function indexUrl(build: string): string {
  return `${TILES_ROOT}/routes/${build}/index.json`;
}

// A path's parts: /hikes/canada/alberta/jasper-national-park/tonquin-valley
// -> ['canada', 'alberta', 'jasper-national-park', 'tonquin-valley'].
export function parsePath(pathname: string): string[] | null {
  const m = pathname.toLowerCase().match(/^\/hikes(?:\/(.*))?$/);
  if (!m) return null;
  return (m[1] ?? '').split('/').filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());
}

export function hikesPath(parts: string[]): string {
  return ['/hikes', ...parts].join('/');
}

// What a path names, resolved against regions.json: the country, state and
// park it walks through, and what's left (a hike's slug).
export interface Resolved {
  country?: Country;
  state?: State;
  area?: Area;
  rest: string[];
  // The first part that named nothing, and the level it was looked up at.
  missing?: { part: string; level: 'country' | 'state' | 'park' };
}

export function resolve(regions: Regions, parts: string[]): Resolved {
  const [c, s, p, ...rest] = parts;
  const out: Resolved = { rest: [] };
  if (!c) return out;
  out.country = regions.countries.find((x) => x.slug === c);
  if (!out.country) return { ...out, missing: { part: c, level: 'country' } };
  if (!s) return out;
  out.state = out.country.states.find((x) => x.slug === s);
  if (!out.state) return { ...out, missing: { part: s, level: 'state' } };
  if (!p) return out;
  out.area = out.state.areas.find((x) => x.slug === p);
  if (!out.area) return { ...out, missing: { part: p, level: 'park' } };
  out.rest = rest;
  return out;
}

// Names that look like `want`, for a not-found page: those sharing a word
// with it, most shared first.
export function suggest<T extends { slug: string; name: string }>(xs: T[], want: string, n = 5): T[] {
  const words = new Set(want.split('-').filter((w) => w.length > 2));
  return xs
    .map((x) => ({ x, score: x.slug.split('-').filter((w) => words.has(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.x.slug.length - b.x.slug.length)
    .slice(0, n)
    .map((s) => s.x);
}

// Breadcrumbs: Hikes › Canada › Alberta › Jasper National Park › ...; the
// last one is the page itself.
export function crumbs(levels: { name: string; slug: string }[]): Crumb[] {
  const out: Crumb[] = [{ name: 'Hikes', path: '/hikes' }];
  const parts: string[] = [];
  for (const l of levels) {
    parts.push(...l.slug.split('/'));
    out.push({ name: l.name, path: hikesPath(parts) });
  }
  return out;
}

// Shorter park names for crumbs, as search shows them.
export function shortName(s: string): string {
  return s.replace('National Park', 'NP').replace('State Park', 'SP').replace('Provincial Park', 'PP').replace('National Forest', 'NF');
}

// One park's routes document, from the routes bundle (a byte range of it,
// gzipped), on the server or in the browser.
export async function parkDoc(build: string, index: BundleIndex | null, park: string): Promise<ParkDoc | null> {
  const at = index?.parks?.[park];
  if (!at) return null;
  const [offset, length] = at;
  const r = await fetch(`${TILES_ROOT}/routes/${build}/${index.bundle}`, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (!r.ok) return null;
  const bytes = await r.arrayBuffer();
  const part = r.status === 206 ? bytes : bytes.slice(offset, offset + length);
  const text = await new Response(new Blob([part]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// What an index page lists (#55): the countries, a country's states, or a
// state's parks and trail areas, with paths and counts.
export function regionList(regions: Regions, r: Resolved): { heading: string; items: { name: string; path: string; meta: string }[]; bbox: Bbox | null } {
  if (r.state && r.country) {
    return {
      heading: `Hikes in ${r.state.name}`,
      bbox: r.state.bbox,
      items: r.state.areas.map((a) => ({ name: a.name, path: hikesPath([r.country!.slug, r.state!.slug, a.slug]), meta: count(a.hikes, 'hike') })),
    };
  }
  if (r.country) {
    return {
      heading: `Hikes in ${r.country.name}`,
      bbox: r.country.bbox,
      items: r.country.states.map((s) => ({ name: s.name, path: hikesPath([r.country!.slug, s.slug]), meta: `${count(s.parks, 'park')} · ${count(s.hikes, 'hike')}` })),
    };
  }
  return {
    heading: 'Hikes in North America',
    bbox: null,
    items: regions.countries.map((c) => ({ name: c.name, path: hikesPath([c.slug]), meta: `${count(c.parks, 'park')} · ${count(c.hikes, 'hike')}` })),
  };
}

export function hikeCount(n: number): string {
  return count(n, 'hike');
}
