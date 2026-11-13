// Curated hikes on the map. The basemap's "route" layer (from
// hikeratlas/routes) highlights them; clicking one opens its details: the
// distance and climb, an elevation chart with campsites along the way, and
// what it passes. Each park's routes are in full in a bundle,
// <TILES_ROOT>/routes/<build>/<bundle>: every park's JSON gzipped, end to end,
// located by <TILES_ROOT>/routes/<build>/index.json ({bundle, parks: {<park
// osm id>: [offset, length]}}), so a build uploads 2 files, not one per park.
// Builds from before the bundle have <TILES_ROOT>/routes/<build>/<park>.json.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, LineLayerSpecification, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import { TILES_ROOT, tilesUrl } from '~/build';
import RegionItems from '~/components/RegionItems';
import { hikeEntries, loadRegions, nearbyParks, parkReports, reportsKey, type BaseCamp, type BundleIndex, type ParkDoc, type ParkReports, type RegionItem, type Route, type RouteReports, type SeeAlso, type Stop } from '~/hikes';
import AppLink from './AppLink';
import { profile, type Profile } from '~/routing/elevation';
import { trailGeometry, type TrailGeometry } from '~/routing/trail';
import { CoalescingSource, type Source } from '~/routing/source';
import { withZstd, type Decompress } from '~/zstd';
import { ElevationChart } from './RoutePlanner';
import ParkSheet, { type NearbyPark } from './ParkSheet';
import { isSmall, shapeWords, trailhead } from '~/park';
import HikeSheet, { alongOf } from './HikeSheet';

declare const pmtiles: {
  FetchSource: new (url: string) => Source;
  PMTiles: new (source: string | Source, cache?: unknown, decompress?: Decompress) => {
    decompress: Decompress;
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
  };
};

const LAYER = 'routes-route';
// The basemap's park names (styles/parks.json's label-park, prefixed by
// mapt): clicking one with curated hikes lists them (#59).
const PARK_LABEL = 'parks-label-park';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const COLOR = '#c026d3';

// A build's index of the parks' routes in its bundle.
const indexes = new Map<string, Promise<BundleIndex>>();
export function bundleIndex(build: string): Promise<BundleIndex> {
  const url = `${TILES_ROOT}/routes/${build}/index.json`;
  if (!indexes.has(url)) {
    indexes.set(
      url,
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} fetching ${url}`)))),
    );
  }
  return indexes.get(url)!;
}

async function fetchPark(build: string, park: string): Promise<ParkDoc> {
  const index = await bundleIndex(build);
  const at = index.parks[park];
  if (!at) throw new Error(`no routes for park ${park} in ${build}`);
  const [offset, length] = at;
  const url = `${TILES_ROOT}/routes/${build}/${index.bundle}`;
  const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  const bytes = await r.arrayBuffer();
  // A server that ignores Range sends the whole bundle: take the park's part.
  const part = r.status === 206 ? bytes : bytes.slice(offset, offset + length);
  const text = await new Response(new Blob([part]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

// Starts loading a route's park and its elevation profile's terrain tiles,
// for a page opened at a hike: these don't need the map, so they needn't
// wait for it to load (select() then finds both cached).
export function prefetchRoute(build: string, park: string, id: string) {
  parkRoutes(build, park).then((doc) => {
    const s = lookup(doc, id);
    if (s) profile(s.route.line).catch(() => {});
  }).catch(() => {});
}

const parks = new Map<string, Promise<ParkDoc>>();
export function parkRoutes(build: string, park: string): Promise<ParkDoc> {
  const key = `${build}/${park}`;
  if (!parks.has(key)) parks.set(key, fetchPark(build, park));
  return parks.get(key)!;
}

// A park's pages about its routes (trip reports, hikeratlas/cc-crawler), from
// the build's reports bundle; null when it has none for the park.
const reportsCache = new Map<string, Promise<ParkReports | null>>();
function reportsFor(build: string, park: string): Promise<ParkReports | null> {
  const key = `${build}/${park}`;
  if (!reportsCache.has(key)) {
    reportsCache.set(key, bundleIndex(build).then((index) => parkReports(build, index, park)).catch(() => null));
  }
  return reportsCache.get(key)!;
}

// Forget a build's index and park routes, so the next call fetches the
// current ones. A tab kept open across a routes build holds the old index,
// while search already returns the new build's hikes (basemap#185).
export function refreshBundle(build: string) {
  indexes.delete(`${TILES_ROOT}/routes/${build}/index.json`);
  for (const k of [...parks.keys()]) if (k.startsWith(`${build}/`)) parks.delete(k);
  for (const k of [...reportsCache.keys()]) if (k.startsWith(`${build}/`)) reportsCache.delete(k);
}

interface Selected {
  id: string;
  title: string;
  label: string;
  route: Route;
  why?: [string, number][];
  base?: BaseCamp; // the base camp, for its walk in and day hikes from camp
  baseIndex?: number;
  // Where it starts ("from the Lake Louise lakeshore"), and its shape.
  from?: string;
  shape: 'loop' | 'out-and-back' | 'one-way';
}

const shapeOf = (kind: string): Selected['shape'] => (kind === 'loop' ? 'loop' : kind === 'out-and-back' ? 'out-and-back' : 'one-way');

const KIND: Record<string, string> = { 'out-and-back': 'out and back', loop: 'loop', 'one-way': 'one way', 'point-to-point': 'point to point (needs a shuttle)' };
// A day hike's kind in words: a one-way hike (website#109) says how you come
// back, where known ("one way, Blue Grouse Gondola down").
const kindOf = (h: { kind: string; return_by?: string }) => (h.kind === 'one-way' ? shapeWords(h.kind, h.return_by) : KIND[h.kind] ?? h.kind);

// A route that follows an OSM hiking route carries its name (hikeratlas/routes'
// recall::name_routes): "Colchuck Lake Trail", not "Colchuck Lake from Stuart
// Lake Trailhead".
function named(r: { name?: string | null }, otherwise: string): string {
  return typeof r.name === 'string' && r.name ? r.name : otherwise;
}

// The route an id names: <park>/day/i, <park>/stop/i (a short walk to a
// sight from where the car is, hikeratlas/routes#70), <park>/base/i (the walk
// in to a base camp), <park>/base/i/j (a day hike from it), or <park>/multi/i.
function lookup(doc: ParkDoc, id: string): Selected | null | undefined {
  const [, type, i, j] = id.split('/');
  if (type === 'day') {
    const h = doc.day_hikes[+i];
    return h && { id, title: named(h, `${h.dest} from ${h.from}`), label: `Day hike · ${kindOf(h)}`, route: h.route, why: h.why, from: h.from, shape: shapeOf(h.kind) };
  }
  if (type === 'stop') {
    const h = doc.stops?.[+i];
    return h && { id, title: h.dest, label: `Stop · ${walk(h)}`, route: h.route, why: h.why, from: h.from, shape: 'out-and-back' };
  }
  if (type === 'base') {
    const b = doc.base_camps[+i];
    if (!b) return null;
    if (j === undefined) return { id, title: `${b.camp}`, label: `Base camp · walk in from ${b.from}`, route: b.approach, base: b, baseIndex: +i, from: b.from, shape: 'one-way' };
    const h = b.hikes[+j];
    return h && { id, title: named(h, `${h.dest} from ${b.camp}`), label: `Day hike from base camp · ${kindOf(h)}`, route: h.route, why: h.why, base: b, baseIndex: +i, from: b.camp, shape: shapeOf(h.kind) };
  }
  if (type === 'multi') {
    const t = doc.point_to_points[+i];
    return t && { id, title: named(t, `${t.from} to ${t.to}`), label: `Multi-day · ${KIND[t.kind] ?? KIND['point-to-point']}`, route: t.route, from: t.from, shape: shapeOf(t.kind) };
  }
  return null;
}

// How far a stop is from the car: a pull-out has no walk.
function walk(h: Stop): string {
  const km = h.route.one_way_km ?? h.route.km / 2;
  // An unnamed road's end is "Road's end" in hikeratlas/routes.
  const end = h.from === "Road's end";
  if (km < 0.05) return end ? 'by the road' : `by the road at ${h.from}`;
  return `${km.toFixed(1)} km walk from ${end ? "the road's end" : h.from}`;
}

// A route in a list: the routes under a click, in view, or in a park. Items
// with a section (a park's stops) are listed under its heading.
interface Item { park: string; id: string; title: string; meta: string; section?: string }
interface List { heading: string; items: Item[]; about?: ParkAbout }

// A park's operator and official website (#72): from its routes record
// (hikeratlas/routes' park), or, for a park without hikes, its map label.
export interface ParkAbout { operator?: string; website?: string }

const aboutOf = (p: { operator?: unknown; website?: unknown } | null | undefined): ParkAbout | undefined => {
  const operator = typeof p?.operator === 'string' && p.operator ? p.operator : undefined;
  const website = typeof p?.website === 'string' && /^https?:\/\//i.test(p.website) ? p.website : undefined;
  return operator || website ? { operator, website } : undefined;
};

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

function About({ about }: { about: ParkAbout }) {
  return <div className='text-gray-600 text-sm'>
    {about.operator}
    {about.operator && about.website && ' · '}
    {about.website && <a href={about.website} target='_blank' rel='noopener noreferrer' className='text-blue-700 hover:underline'
      title='Official website'>{hostOf(about.website)} ↗</a>}
  </div>;
}

const TYPE_LABEL: Record<string, string> = { day: 'Day hike', approach: 'Base camp', 'multi-day': 'Multi-day', 'from-camp': 'From camp', stop: 'Stop' };
const TYPE_ORDER: Record<string, number> = { day: 0, approach: 1, 'multi-day': 2, 'from-camp': 3, stop: 4 };

function meta(type: string, km: number, gain: number, sac?: number): string {
  return `${TYPE_LABEL[type] ?? type} · ${km.toFixed(1)} km · ↑ ${Math.round(gain).toLocaleString()} m${(sac ?? 0) >= 4 ? ' · scramble' : ''}`;
}

// Items from the route layer's features (properties as in hikeratlas/routes'
// routes.geojsonl), one per route, best first within each park.
function itemsFromFeatures(features: MapGeoJSONFeature[], fromCamp = true): Item[] {
  const seen = new Map<string, MapGeoJSONFeature['properties']>();
  for (const f of features) if (!seen.has(f.properties.id)) seen.set(f.properties.id, f.properties);
  return [...seen.values()]
    .filter((p) => fromCamp || p.type !== 'from-camp')
    .sort((a, b) => String(a.park).localeCompare(String(b.park))
      || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
      || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    .map((p) => ({
      park: String(p.park_id),
      id: String(p.id),
      title: p.type === 'approach' ? `Base camp: ${p.title}` : String(p.title),
      meta: meta(p.type, Number(p.km), Number(p.gain)),
    }));
}

// Items for a whole park, from its JSON.
function itemsFromPark(doc: ParkDoc): Item[] {
  const park = String(doc.park!.id);
  return [
    ...doc.day_hikes.map((h, i) => ({ park, id: `${park}/day/${i}`, title: named(h, `${h.dest} from ${h.from}`), meta: meta('day', h.route.km, h.route.gain, h.route.max_sac) })),
    ...doc.base_camps.map((b, i) => ({ park, id: `${park}/base/${i}`, title: `Base camp: ${b.camp} from ${b.from}`, meta: `${b.hikes.length} day hikes from camp · walk in ${b.approach.km.toFixed(1)} km` })),
    ...doc.point_to_points.map((t, i) => ({ park, id: `${park}/multi/${i}`, title: named(t, `${t.from} to ${t.to}`), meta: meta('multi-day', t.route.km, t.route.gain, t.route.max_sac) })),
    // Multi-day trips of a smaller park inside this one (hikeratlas/routes:
    // Guadalupe Mountains NP lists its Wilderness's), opened in that park.
    ...((doc.see_also ?? []) as SeeAlso[]).map((e) => ({ park: String(e.park), id: e.id, title: named(e, `${e.from} to ${e.to}`), meta: `${meta('multi-day', e.km, e.gain)} · in ${e.park_name}` })),
    // Stops: short walks to a sight from where the car is, in their own
    // section (hikeratlas/routes#70).
    ...((doc.stops ?? []) as Stop[]).map((h, i) => ({ park, id: `${park}/stop/${i}`, title: h.dest, meta: walk(h).replace(/^./, (c) => c.toUpperCase()), section: 'Stops' })),
  ];
}

// A park picked in search (list its hikes), or with route, a hike picked in
// search (open it): route is its id, as select() takes.
// fit: whether opening route fits the map to it (default yes); not when the
// map is already there (a search pick) or the URL says where to look.
export interface FocusPark { id: string; name: string; at: number; route?: string; fit?: boolean }

// An OSM trail picked in search (#242): its panel shows its length, its
// elevation (from its ways in the tiles) and the park's hikes that walk it.
// parkId: the park's routes id, when the park has curated hikes.
export interface FocusTrail {
  name: string; at: number; km?: number | null; park?: string | null; state?: string | null;
  parkId?: string; box?: [number, number, number, number];
}

interface TrailState {
  focus: FocusTrail;
  loading: boolean;
  geom?: TrailGeometry | null;
  prof?: Profile | null; // end to end, or along its longest stretch
  along?: number | null; // metres, if prof is its longest stretch
  range?: [number, number] | null; // low and high points
  hikes?: Item[];
}

// What the panel shows, for the page's URL (#55, #56): a park's hike list, a
// hike, some other list (hikes in view, routes under a click: no URL of its
// own), or nothing.
export type Showing =
  | { type: 'park'; park: string; name: string }
  | { type: 'hike'; park: string; id: string; title: string }
  | { type: 'other' }
  | null;

// A list of places to go to rather than routes: the states of a country, the
// parks of a state (#55's index pages), shown when nothing else is open.
export interface RegionList { heading: string; items: RegionItem[]; cards?: string }

export interface Crumb { name: string; href: string; path: string }

interface Props {
  map: MaplibreMap | null;
  build: string;
  focusPark?: FocusPark | null;
  focusTrail?: FocusTrail | null;
  onShowing?: (s: Showing) => void;
  // Breadcrumbs for what's showing, and where clicking one goes.
  crumbs?: Crumb[];
  region?: RegionList | null;
  onNavigate?: (path: string) => void;
  // Closes the panel when it changes (Back to /map).
  closeAt?: number;
  // A note above the panel's content ("That hike has changed...").
  note?: string | null;
  // A park's name clicked on the map, for a park with curated hikes (#59).
  onPark?: (id: string, name: string) => void;
}

// A trail's elevation and the hikes that walk it (#242).
function TrailBody({ trail, onHover, onHike, onPark }: {
  trail: TrailState; onHover: (c: [number, number] | null) => void; onHike: (park: string, id: string) => void; onPark?: () => void;
}) {
  const { prof, range, along, loading, hikes, geom } = trail;
  const m = (x: number) => `${Math.round(x).toLocaleString()} m`;
  return <>
    {prof && <div className='mt-1'>↑ {m(prof.gain)} · ↓ {m(prof.loss)} {along ? `along ${(along / 1000).toFixed(1)} km of it` : 'end to end'}{range && ` · high point ${m(range[1])} · low point ${m(range[0])}`}</div>}
    {!prof && range && <div className='mt-1'>High point {m(range[1])} · low point {m(range[0])}</div>}
    {prof
      ? <ElevationChart points={prof.points} lo={range![0]} hi={range![1]} onHover={(i) => onHover(i === null ? null : prof.coords[i])} />
      : loading && <div className='h-[40px] text-gray-400 flex items-center'>Measuring elevation…</div>}
    {!loading && geom === null && <div className='mt-1 text-gray-500 text-xs'>Too long to measure here.</div>}
    {hikes && hikes.length > 0 && <>
      <h3 className='font-semibold text-gray-700 mt-2 mb-0.5'>Hikes on this trail</h3>
      <ul>{hikes.map((h) => <li key={h.id} className='py-0.5'>
        <button className='tap-row text-blue-700 hover:underline text-left' onClick={() => onHike(h.park, h.id)}>{h.title}</button>
        <div className='text-gray-500 text-xs'>{h.meta}</div>
      </li>)}</ul>
    </>}
    {!loading && hikes && hikes.length === 0 && <div className='mt-2 text-gray-500'>
      No curated hikes use this trail yet.
      {onPark && <> <button className='tap text-blue-700 hover:underline' onClick={onPark}>Hikes in the park</button></>}
    </div>}
  </>;
}

export default function CuratedRoutes(props: Props) {
  // Consts, so checks of map hold in the handlers below.
  const { map, build, focusPark, focusTrail, onShowing, crumbs, region, onNavigate, closeAt, note, onPark } = props;
  const [sel, setSel] = useState<Selected | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The selected route's pages on other sites (trip reports), once loaded.
  const [reps, setReps] = useState<{ id: string; reports: RouteReports | null; dest?: string; key?: string; park?: string; parkId?: string } | null>(null);
  // A list of routes to pick from (see Item), and whether it's showing or a
  // route's details are.
  const [list, setList] = useState<List | null>(null);
  const [mode, setMode] = useState<'list' | 'detail' | 'trail' | null>(null);
  // An OSM trail picked in search, and what's known of it so far (#242).
  const [trailInfo, setTrail] = useState<TrailState | null>(null);
  // The basemap's tiles, for a trail's ways (as RoutePlanner reads them).
  const tiles = useRef<{ url: string; archive: { getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined> } } | null>(null);
  // The routes in view, for the "hikes in view" button.
  const [inView, setInView] = useState<Item[]>([]);
  const added = useRef(false);
  // On phones the panel is a bottom sheet: peek (title and stats), half, or
  // full. Opening a list opens it half way; picking a route drops it to peek
  // so the route shows on the map above it.
  const phone = useIsPhone();
  const [snap, setSnap] = useState<Snap>('half');

  // The park whose list is open, if the list is a park's (not "in view").
  const [listPark, setListPark] = useState<{ id: string; name: string } | null>(null);
  // That park's routes and trip reports, for its sheet (ParkSheet), and for
  // a small park, the parks near it with more hikes.
  const [parkView, setParkView] = useState<{ id: string; doc: ParkDoc; reports: ParkReports | null; nearby: NearbyPark[] | null } | null>(null);
  const openList = (l: List, park: { id: string; name: string } | null = null) => {
    setList(l); setMode('list'); setError(null); setSnap('half'); setListPark(park);
  };

  const setData = useCallback((id: string, data: GeoJSON.GeoJSON) => map?.getSource<GeoJSONSource>(id)?.setData(data), [map]);

  const addLayers = useCallback(() => {
    if (added.current) return;
    added.current = true;
    // Called once the map is up.
    const map = props.map!;
    map.addSource('curated-sel', { type: 'geojson', data: EMPTY });
    map.addSource('curated-hover', { type: 'geojson', data: EMPTY });
    // A park's routes while its sheet is open: those the filters leave in
    // magenta, the others grey, the one pointed at in the list thick. The
    // basemap's routes start at z9; a park's view is often wider.
    map.addSource('curated-park', { type: 'geojson', data: EMPTY });
    const round: LineLayerSpecification['layout'] = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'curated-park-casing', type: 'line', source: 'curated-park', layout: round, filter: ['get', 'on'], paint: { 'line-color': '#ffffff', 'line-width': 4 } });
    map.addLayer({
      id: 'curated-park', type: 'line', source: 'curated-park', layout: round,
      paint: { 'line-color': ['case', ['get', 'on'], COLOR, '#a8a29e'], 'line-width': ['case', ['get', 'on'], 2.5, 1.5], 'line-opacity': ['case', ['get', 'on'], 0.9, 0.6] },
    });
    map.addLayer({ id: 'curated-park-hl-casing', type: 'line', source: 'curated-park', layout: round, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    map.addLayer({ id: 'curated-park-hl', type: 'line', source: 'curated-park', layout: round, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#a21caf', 'line-width': 5 } });
    map.addLayer({ id: 'curated-sel-casing', type: 'line', source: 'curated-sel', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: 'curated-sel', type: 'line', source: 'curated-sel', layout: round, paint: { 'line-color': COLOR, 'line-width': 4 } });
    map.addLayer({
      id: 'curated-stops', type: 'circle', source: 'curated-sel', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'n']]],
      paint: { 'circle-radius': 6, 'circle-color': '#16a34a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
    map.addLayer({ id: 'curated-feat', type: 'circle', source: 'curated-sel', filter: ['has', 'n'], paint: { 'circle-radius': 9, 'circle-color': '#a21caf', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    map.addLayer({
      id: 'curated-feat-n', type: 'symbol', source: 'curated-sel', filter: ['has', 'n'],
      layout: { 'text-field': ['get', 'n'], 'text-font': ['Metropolis Semi Bold'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#ffffff' },
    });
    map.addLayer({ id: 'curated-hover', type: 'circle', source: 'curated-hover', paint: { 'circle-radius': 6, 'circle-color': '#0b0b0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
  }, [props.map]);

  // fit: fit the map to the route (#90). Not for a route clicked on the map:
  // it's already in view.
  const select = useCallback(async (park: string, id: string, fit = true) => {
    setError(null);
    setMode('detail');
    setSnap('peek');
    try {
      const doc = await parkRoutes(build, park);
      const s = lookup(doc, id);
      if (!s) { setError('That route is no longer available.'); return; }
      // As its page and breadcrumbs title it.
      s.title = hikeEntries(doc).find((e) => e.id === id)?.title ?? s.title;
      // A day hike from a base camp starts at the camp; don't list it as a stop.
      if (s.base && id.split('/').length === 4) s.route = { ...s.route, stopovers: s.route.stopovers.filter((c) => c.name !== s.base!.camp) };
      addLayers();
      setSel(s);
      setProf(null);
      setData('curated-sel', {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.route.line } },
          ...s.route.stopovers.map((c): GeoJSON.Feature => ({ type: 'Feature', properties: { name: c.name }, geometry: { type: 'Point', coordinates: c.at } })),
          // What it passes, numbered as in the sheet's "Along the way".
          ...alongOf(s.route).filter((f) => f.at).map((f): GeoJSON.Feature => ({ type: 'Feature', properties: { n: String(f.n) }, geometry: { type: 'Point', coordinates: f.at! } })),
        ],
      });
      if (window.matchMedia(PHONE).matches) fitAbove(map!, s.route.line, PEEK_PX);
      else if (fit) fitBeside(map!, s.route.line);
      setProf(await profile(s.route.line));
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  }, [build, map, addLayers, setData]);

  const close = useCallback(() => {
    setTrail(null);
    setListPark(null);
    setSel(null);
    setProf(null);
    setList(null);
    setMode(null);
    setError(null);
    setData('curated-sel', EMPTY);
    setData('curated-hover', EMPTY);
    setData('curated-park', EMPTY);
  }, [setData]);

  useEffect(() => {
    if (!map) return;
    // The route planner takes over clicks while it's active (crosshair).
    const planning = () => map.getCanvas().style.cursor === 'crosshair';
    const at = (e: MapMouseEvent) => {
      if (!map.getLayer(LAYER)) return [];
      const { x, y } = e.point;
      return map.queryRenderedFeatures([[x - 4, y - 4], [x + 4, y + 4]], { layers: [LAYER] });
    };
    // Parks with curated hikes, from the routes index, once it's loaded:
    // only their names are clickable.
    let hiked = new Set<string>();
    bundleIndex(build).then((idx) => { hiked = new Set(Object.keys(idx.parks ?? {})); }).catch(() => {});
    const parkAt = (e: { point: { x: number; y: number } }) => {
      if (!onPark || !map.getLayer(PARK_LABEL)) return null;
      const { x, y } = e.point;
      // Parks with hikes open their list; others, only if their label says
      // who runs them or where their website is (#72).
      const f = map.queryRenderedFeatures([[x - 2, y - 2], [x + 2, y + 2]], { layers: [PARK_LABEL] })
        .find((f: { properties?: Record<string, unknown> }) => hiked.has(String(f.properties?.osm_id)) || aboutOf(f.properties));
      return f ? {
        id: String(f.properties.osm_id), name: String(f.properties.name ?? f.properties.short_name ?? ''),
        hiked: hiked.has(String(f.properties.osm_id)), about: aboutOf(f.properties),
      } : null;
    };
    const onClick = (e: MapMouseEvent) => {
      if (planning()) return;
      const found = itemsFromFeatures(at(e));
      if (found.length === 1) { setList(null); select(found[0].park, found[0].id, false); }
      else if (found.length > 1) openList({ heading: `${found.length} routes here`, items: found });
      else {
        const p = parkAt(e);
        if (p?.hiked) onPark?.(p.id, p.name);
        // No hikes: just the park, who runs it and its website.
        else if (p) openList({ heading: p.name, items: [], about: p.about });
      }
    };
    const onMove = (e: MapMouseEvent) => {
      if (planning()) return;
      map.getCanvas().style.cursor = at(e).length || parkAt(e) ? 'pointer' : '';
    };
    // The routes in view, once zoomed in far enough to see them (z9).
    const onIdle = () => {
      if (!map.getLayer(LAYER) || map.getZoom() < 9) { setInView([]); return; }
      setInView(itemsFromFeatures(map.queryRenderedFeatures({ layers: [LAYER] }), false));
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('moveend', onIdle);
    map.once('idle', onIdle);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); map.off('moveend', onIdle); };
  }, [map, build, onPark, select]);

  // A park picked in search: list its routes, if it has any. A hike picked
  // in search (#44): open it.
  useEffect(() => {
    if (!map || !focusPark) return;
    if (focusPark.route) {
      // As if from the park's list, so "←" goes back to it.
      parkRoutes(build, focusPark.id)
        .then((doc) => { setList({ heading: `Hikes in ${doc.park?.name ?? focusPark.name}`, items: itemsFromPark(doc), about: aboutOf(doc.park) }); setListPark({ id: focusPark.id, name: doc.park?.name ?? focusPark.name }); })
        .catch(() => {});
      select(focusPark.id, focusPark.route, focusPark.fit !== false);
      return;
    }
    parkRoutes(build, focusPark.id)
      .then((doc) => openList({ heading: `Hikes in ${doc.park?.name ?? focusPark.name}`, items: itemsFromPark(doc), about: aboutOf(doc.park) }, { id: focusPark.id, name: doc.park?.name ?? focusPark.name }))
      // Most parks have no curated routes; just close what was open.
      .catch(() => close());
  }, [map, build, focusPark, close, select]);

  // An OSM trail picked in search (#242): draw it, measure it, and find the
  // park's hikes that walk it (their routes' "via").
  useEffect(() => {
    if (!map || !focusTrail) return;
    const f = focusTrail;
    let live = true;
    setSel(null); setProf(null); setList(null); setListPark(null); setError(null);
    setTrail({ focus: f, loading: true });
    setMode('trail');
    setSnap('half');
    addLayers();
    setData('curated-sel', EMPTY);
    setData('curated-hover', EMPTY);
    const url = tilesUrl(build);
    if (tiles.current?.url !== url) {
      const decompress = withZstd(new pmtiles.PMTiles('').decompress);
      tiles.current = { url, archive: new pmtiles.PMTiles(new CoalescingSource(new pmtiles.FetchSource(url)), undefined, decompress) };
    }
    const archive = tiles.current.archive;
    const want = f.name.trim().toLowerCase();
    const hikes: Promise<Item[]> = f.parkId
      ? parkRoutes(build, f.parkId).then((doc) => itemsFromPark(doc).filter((it) => it.park === f.parkId
        && (lookup(doc, it.id)?.route.via ?? []).some((v) => v.trim().toLowerCase() === want))).catch(() => [])
      : Promise.resolve([]);
    (async () => {
      const geom = f.box ? await trailGeometry(archive, f.name, f.box).catch(() => null) : null;
      if (!live) return;
      if (geom) {
        setData('curated-sel', {
          type: 'FeatureCollection',
          features: geom.lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })),
        });
      }
      setTrail((s) => s && { ...s, geom });
      let prof: Profile | null = null;
      let range: [number, number] | null = null;
      let along: number | null = null;
      try {
        if (geom?.single || geom?.longest) {
          prof = await profile((geom.single ?? geom.longest)!);
          const es = prof.points.map(([, e]) => e);
          range = [Math.min(...es), Math.max(...es)];
          if (!geom.single) {
            along = prof.points[prof.points.length - 1][0];
            // The rest of the trail can reach higher or lower.
            const all = await Promise.all(geom.lines.slice(0, 50).map((l) => profile(l, 20)));
            const more = all.flatMap((p) => p.points.map(([, e]) => e));
            range = [Math.min(range[0], ...more), Math.max(range[1], ...more)];
          }
        } else if (geom && geom.lines.length > 0) {
          // Branched or in pieces: no one direction to climb along, so
          // just its low and high points.
          const ps = await Promise.all(geom.lines.slice(0, 50).map((l) => profile(l, 20)));
          const es = ps.flatMap((p) => p.points.map(([, e]) => e));
          range = [Math.min(...es), Math.max(...es)];
        }
      } catch { /* no elevation: the panel just omits it */ }
      const found = await hikes;
      if (!live) return;
      if (found.length > 0) setList({ heading: `Hikes on ${f.name}`, items: found });
      setTrail((s) => s && { ...s, prof, range, along, hikes: found, loading: false });
    })();
    return () => { live = false; };
  }, [map, build, focusTrail, addLayers, setData]);

  // The open park's routes, trip reports and (for a small park) neighbours.
  useEffect(() => {
    if (!listPark) { setParkView(null); return; }
    let live = true;
    (async () => {
      const doc = await parkRoutes(build, listPark.id);
      const reports = await reportsFor(build, String(doc.park?.id ?? listPark.id));
      if (!live) return;
      setParkView({ id: listPark.id, doc, reports, nearby: null });
      if (isSmall(doc)) {
        const regions = await loadRegions(build);
        if (live && regions) setParkView({ id: listPark.id, doc, reports, nearby: nearbyParks(regions, listPark.id) });
      }
    })().catch(() => { if (live) setParkView(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, listPark?.id]);
  useEffect(() => { if (mode !== 'list') setData('curated-park', EMPTY); }, [mode, setData]);

  // The park sheet's routes on the map: its day hikes, those in `ids`
  // highlighted; with ids null (another tab open), everything, base camps,
  // trips and stops too.
  const showPark = useCallback((ids: string[] | null) => {
    if (!parkView || !map) return;
    addLayers();
    const { doc } = parkView;
    const park = String(doc.park?.id ?? parkView.id);
    const on = new Set(ids ?? []);
    const line = (id: string, coords: [number, number][]): GeoJSON.Feature => ({ type: 'Feature', properties: { id, on: !ids || on.has(id) }, geometry: { type: 'LineString', coordinates: coords } });
    setData('curated-park', {
      type: 'FeatureCollection',
      features: [
        ...doc.day_hikes.map((h, i) => line(`${park}/day/${i}`, h.route.line)),
        ...(!ids ? [
          ...doc.base_camps.map((b, i) => line(`${park}/base/${i}`, b.approach.line)),
          ...doc.point_to_points.map((t, i) => line(`${park}/multi/${i}`, t.route.line)),
          ...((doc.stops ?? []) as Stop[]).map((t, i) => line(`${park}/stop/${i}`, t.route.line)),
        ] : []),
      ],
    });
  }, [parkView, map, addLayers, setData]);
  const hoverPark = useCallback((id: string | null) => {
    for (const l of ['curated-park-hl-casing', 'curated-park-hl']) if (map?.getLayer(l)) map.setFilter(l, ['==', ['get', 'id'], id ?? '']);
  }, [map]);

  // The selected route's trip reports: filed under its key (its id in builds
  // without keys).
  useEffect(() => {
    if (!sel) return;
    let live = true;
    const park = sel.id.split('/')[0];
    // Filed under the routes document's park id (a park mapped twice has its
    // routes under one of its ids).
    parkRoutes(build, park)
      .then(async (doc) => {
        const all = await reportsFor(build, String(doc.park?.id ?? park));
        const { key, dest } = reportsKey(doc, sel.id);
        if (live) setReps({ id: sel.id, reports: all?.[key] ?? null, dest, key, park: doc.park?.name, parkId: doc.park?.id != null ? String(doc.park.id) : undefined });
      })
      .catch(() => { if (live) setReps({ id: sel.id, reports: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, sel?.id]);

  // Tell the page what's showing, for its URL.
  useEffect(() => {
    if (!onShowing) return;
    if (mode === 'detail' && sel) onShowing({ type: 'hike', park: sel.id.split('/')[0], id: sel.id, title: sel.title });
    else if (mode === 'list' && listPark) onShowing({ type: 'park', park: listPark.id, name: listPark.name });
    else if (mode === 'list' || mode === 'trail') onShowing({ type: 'other' });
    else if (mode === null && !error) onShowing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sel?.id, listPark?.id]);

  // Only when closeAt changes: close also changes when the map arrives, which
  // isn't a reason to close.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (closeAt) close(); }, [closeAt]);

  if (!map) return null;

  const button = inView.length > 0 && mode === null && <button
    className='tap absolute top-3 bg-white rounded shadow px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50'
    style={{ zIndex: 2, left: 84 }}
    onClick={() => openList({ heading: `${inView.length} curated ${inView.length === 1 ? 'hike' : 'hikes'} in view`, items: inView })}
    title='Hikes picked for this area'
  >{inView.length} {inView.length === 1 ? 'hike' : 'hikes'} in view</button>;

  const trail = crumbs && crumbs.length > 0 && <Crumbs crumbs={crumbs} phone={phone} onNavigate={onNavigate} />;

  // A list of states or parks (#55's index pages), when no route is open.
  if (mode === null && !error && region) {
    return <Sheet phone={phone} snap={snap} setSnap={setSnap}>
      <div data-drag style={phone ? { touchAction: 'none' } : undefined}>
        <Toolbar left={trail} app={!!trail} onClose={() => onNavigate?.('/map')} />
        <h2 className='font-display text-[24px] font-extrabold leading-tight tracking-tight text-stone-900'>{region.heading}</h2>
      </div>
      {note && <div className='text-gray-600 mt-1'>{note}</div>}
      <RegionItems items={region.items} build={build} cards={region.cards} onNavigate={onNavigate} />
    </Sheet>;
  }

  if (mode === null && !error) return button || null;

  const r = sel?.route;
  // The park's sheet, once its routes are in (until then, the plain list).
  const sheet = mode === 'list' && listPark && parkView?.id === listPark.id ? parkView : null;
  return <Sheet phone={phone} snap={snap} setSnap={setSnap}>
    {/* data-drag: on a phone, dragging the header row moves the sheet. */}
    <div data-drag style={phone ? { touchAction: 'none' } : undefined}>
      {/* A /hikes page (it has breadcrumbs): the Android app can open it. */}
      <Toolbar app={!!trail} onClose={close} left={<>
        {trail}
        {(!trail || !listPark) && mode === 'detail' && list && <button className='tap inline-flex items-center text-left text-sm text-blue-700 hover:underline' onClick={() => setMode('list')}>← {list.heading}</button>}
      </>} />
      <div>
        {mode === 'list' && list && (sheet
          ? <h1 className='font-display text-[28px] font-extrabold leading-tight tracking-tight text-stone-900'>{sheet.doc.park?.name ?? listPark!.name}</h1>
          : <div className='font-semibold text-base'>{list.heading}</div>)}
        {mode === 'trail' && trailInfo && <>
          <div className='font-semibold text-base'>{trailInfo.focus.name}</div>
          <div className='text-gray-600'>{['Trail', trailInfo.focus.km ? `${trailInfo.focus.km.toFixed(1)} km` : null,
            [trailInfo.focus.park, trailInfo.focus.state].filter((x) => x).join(', ') || null].filter((x) => x).join(' · ')}</div>
        </>}
        {mode === 'list' && list?.about && <About about={list.about} />}
        {mode === 'detail' && sel && <h1 className='font-display text-[26px] font-extrabold leading-tight tracking-tight text-stone-900'>{sel.title}</h1>}
        {mode === 'detail' && sel && <div className='text-sm text-stone-700'>{sel.label}{sel.from && !sel.label.includes(sel.from) && !sel.title.includes(sel.from) ? ` · from ${trailhead(sel.from)}` : ''}</div>}
        {error && <div className='text-red-700'>{error}</div>}
        {note && <div className='text-gray-600'>{note}</div>}
      </div>
    </div>
    {mode === 'list' && list && list.items.length === 0 && <div className='mt-1 text-gray-500'>No curated hikes here yet.</div>}
    {mode === 'trail' && trailInfo && <TrailBody trail={trailInfo} onHover={(c) => setData('curated-hover', c ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } } : EMPTY)}
      onHike={(park, id) => select(park, id)} onPark={trailInfo.focus.parkId && onPark ? () => onPark(trailInfo.focus.parkId!, trailInfo.focus.park ?? '') : undefined} />}
    {mode === 'list' && sheet && <ParkSheet key={sheet.id} doc={sheet.doc} reports={sheet.reports} nearby={sheet.nearby}
      onOpen={(park, id) => { hoverPark(null); select(park, id); }} onHover={hoverPark} onShown={showPark}
      onPark={onPark ? (id, name) => onPark(id, name) : undefined} />}
    {mode === 'list' && list && !sheet && <ul className='mt-1'>
      {list.items.map((c, k) => <li key={c.id} className='py-0.5'>
        {c.section && c.section !== list.items[k - 1]?.section && <h3 className='font-semibold text-gray-700 mt-2 mb-0.5'>{c.section}</h3>}
        <button className='tap-row text-blue-700 hover:underline text-left' onClick={() => select(c.park, c.id)}>{c.title}</button>
        <div className='text-gray-500 text-xs'>{c.meta}</div>
      </li>)}
    </ul>}
    {mode === 'detail' && r && sel && <HikeSheet title={sel.title} route={r} shape={sel.shape} why={sel.why} prof={prof}
      reports={reps?.id === sel.id ? reps.reports : null} dest={reps?.id === sel.id ? reps.dest : undefined}
      campLabel={sel.base && !sel.id.split('/')[3] ? 'Camp' : 'Campsites along it'}
      fave={reps?.id === sel.id && reps.key ? { title: sel.title, key: reps.key, park: reps.park, parkId: reps.parkId } : null}
      onHover={(c) => setData('curated-hover', c ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } } : EMPTY)}>
      {sel.base && <section>
        <h2 className='font-display text-base font-bold'>From {sel.base.camp}</h2>
        <ul className='mt-1'>
          {sel.base.hikes.map((h, j) => <li key={j} className='border-b border-stone-100 py-2 text-sm'>
            <button className='tap text-left font-semibold text-blue-700 hover:underline' onClick={() => select(sel.id.split('/')[0], `${sel.id.split('/')[0]}/base/${sel.baseIndex}/${j}`)}>
              {named(h, h.dest)}
            </button> <span className='text-stone-600'>{h.route.km.toFixed(1)} km · ↑ {Math.round(h.route.gain)} m{(h.route.max_sac ?? 0) >= 4 ? ' · scramble' : ''}</span>
          </li>)}
          <li className='py-2 text-sm'><button className='tap font-semibold text-blue-700 hover:underline' onClick={() => select(sel.id.split('/')[0], `${sel.id.split('/')[0]}/base/${sel.baseIndex}`)}>The walk in</button></li>
        </ul>
      </section>}
    </HikeSheet>}
  </Sheet>;
}

// Breadcrumbs (#55): Hikes › Canada › Alberta › Jasper NP; the last is the
// page itself, not a link. On phones just the parent, as "‹ Jasper NP".
// They're links, so they work as such (open in a new tab); a plain click
// navigates within the map.
function Crumbs({ crumbs, phone, onNavigate }: { crumbs: Crumb[]; phone: boolean; onNavigate?: (path: string) => void }) {
  const go = (c: Crumb) => (e: React.MouseEvent) => {
    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onNavigate(c.path);
  };
  if (phone) {
    const parent = crumbs[crumbs.length - 2];
    if (!parent) return null;
    return <a href={parent.href} onClick={go(parent)} className='tap inline-flex max-w-full items-center truncate text-sm text-blue-700 hover:underline'>‹ {parent.name}</a>;
  }
  // The page itself is the heading below, so the trail stops at its parent
  // (a hike's name repeated took a second line, basemap#289).
  const up = crumbs.length > 1 ? crumbs.slice(0, -1) : crumbs;
  return <nav aria-label='Breadcrumb' className='text-xs text-gray-600'>
    <ol className='flex flex-wrap gap-x-1'>
      {up.map((c, i) => <li key={c.path} className='flex gap-x-1'>
        {i > 0 && <span aria-hidden='true'>›</span>}
        {crumbs.length > 1
          ? <a href={c.href} onClick={go(c)} className='text-blue-700 hover:underline'>{c.name}</a>
          : <span aria-current='page'>{c.name}</span>}
      </li>)}
    </ol>
  </nav>;
}

// A sheet's top row: breadcrumbs (or a way back) on the left; the app link
// and close on the right, on one axis; the heading goes below it, the
// sheet's full width (basemap#289: on phones the crumb sat above the pill
// and ×, which squeezed the heading).
function Toolbar({ left, app, onClose }: { left?: React.ReactNode; app: boolean; onClose: () => void }) {
  return <div className='mb-1 flex min-h-8 items-center justify-between gap-2'>
    <div className='min-w-0 flex-1'>{left}</div>
    <div className='-mr-1.5 flex shrink-0 items-center gap-1'>
      {app && <AppLink />}
      <button type='button' aria-label='Close' title='Close' onClick={onClose}
        className='tap flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600'>
        <svg viewBox='0 0 16 16' width='16' height='16' aria-hidden='true'><path d='M4 4l8 8M12 4l-8 8' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' /></svg>
      </button>
    </div>
  </div>;
}

const PHONE = '(max-width: 640px)';
const PEEK_PX = 170;
const FULL_GAP = 110;
type Snap = 'peek' | 'half' | 'full';
const SNAPS: Snap[] = ['peek', 'half', 'full'];

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    setPhone(mq.matches);
    const on = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function fitLine(map: MaplibreMap, line: [number, number][], padding: { top: number; bottom: number; left: number; right: number }) {
  if (line.length < 2) return;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of line) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  map.fitBounds([[w, s], [e, n]], { padding, duration: 600, maxZoom: 15 });
}

// Fit a route into the part of the map a bottom sheet of `bottom` px leaves.
function fitAbove(map: MaplibreMap, line: [number, number][], bottom: number) {
  fitLine(map, line, { top: 70, bottom: bottom + 20, left: 30, right: 30 });
}

// Fit a route into the part of the map left of the desktop panel (the box
// below: 480 px wide, 12 px from the right), if that leaves room for it.
function fitBeside(map: MaplibreMap, line: [number, number][]) {
  const width = map.getContainer().clientWidth;
  const panel = Math.min(480, width - 24) + 12 + 20;
  fitLine(map, line, { top: 70, bottom: 40, left: 30, right: width - panel - 30 >= 240 ? panel : 30 });
}

// The panel: a box on the right on desktop; on phones a bottom sheet.
//
// Dragging works from the handle, the header row (data-drag) and, while the
// sheet is peeking, anywhere on it: not just the 24 px handle. A flick (a
// fast swipe) moves one height in its direction however short it is;
// otherwise the sheet settles at the nearest height. Taps on buttons and
// links aren't drags. A tap on the handle steps through the heights, and a
// tap on a peeking sheet opens it half way.
function Sheet({ phone, snap, setSnap, children }: { phone: boolean; snap: Snap; setSnap: (s: Snap) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y0: number; h0: number; h: number; moved: boolean; onHandle: boolean; samples: [number, number][] } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  if (!phone) {
    return <div
      className='absolute right-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm overflow-y-auto'
      style={{ zIndex: 2, width: 'min(480px, calc(100% - 24px))', maxHeight: 'calc(100% - 48px)' }}
    >{children}</div>;
  }
  // Heights in px, from the map's height (the sheet's offset parent).
  const mapH = () => (ref.current?.offsetParent as HTMLElement | null)?.clientHeight ?? 600;
  // Full stops below the floating search box and the map's buttons (110 px).
  const heightOf = (s: Snap) => s === 'peek' ? PEEK_PX : s === 'half' ? Math.round(mapH() * 0.55) : mapH() - FULL_GAP;
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as Element;
    if (t.closest('button, a, input, summary, svg')) return; // let taps through
    const zone = t.closest('[data-drag]');
    if (!zone || !e.currentTarget.contains(zone)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = ref.current!.getBoundingClientRect().height;
    drag.current = { id: e.pointerId, y0: e.clientY, h0: h, h, moved: false, onHandle: zone.hasAttribute('data-handle'), samples: [[e.timeStamp, e.clientY]] };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dy = d.y0 - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    d.samples.push([e.timeStamp, e.clientY]);
    if (d.samples.length > 6) d.samples.shift();
    if (d.moved) {
      d.h = Math.max(PEEK_PX * 0.6, Math.min(mapH() - FULL_GAP, d.h0 + dy));
      setDragH(d.h);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragH(null);
    if (!d.moved) { // a tap
      if (d.onHandle) setSnap(SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length]);
      else if (snap === 'peek') setSnap('half');
      return;
    }
    const nearest = (h: number) => SNAPS.reduce((a, b) => Math.abs(heightOf(b) - h) < Math.abs(heightOf(a) - h) ? b : a);
    // Velocity over the last ~100 ms, px/ms; up is positive.
    const [t0, y0] = d.samples.find(([t]) => e.timeStamp - t <= 100) ?? d.samples[0];
    const v = (y0 - e.clientY) / Math.max(1, e.timeStamp - t0);
    const flick = Math.abs(v) > 0.3;
    // A flick, or a deliberate swipe (over 24 px) that would otherwise spring
    // back: the next height beyond where it was let go, in the swipe's
    // direction. Otherwise the nearest height.
    if (flick || (nearest(d.h) === nearest(d.h0) && Math.abs(d.h - d.h0) > 24)) {
      const up = flick ? v > 0 : d.h > d.h0;
      const beyond = up
        ? SNAPS.find((s) => heightOf(s) > d.h + 8) ?? 'full'
        : [...SNAPS].reverse().find((s) => heightOf(s) < d.h - 8) ?? 'peek';
      setSnap(beyond);
    } else {
      setSnap(nearest(d.h));
    }
  };
  const h = dragH ?? heightOf(snap);
  const peek = snap === 'peek' && dragH === null;
  return <div ref={ref}
    className='sheet absolute left-0 right-0 bottom-0 bg-white rounded-t-xl shadow-[0_-2px_12px_rgba(0,0,0,0.18)] text-sm flex flex-col'
    style={{ zIndex: 2, height: h, transition: dragH === null ? 'height 200ms ease-out' : 'none' }}
    data-snap={snap}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
  >
    <div role='button' aria-label='Resize panel' title='Drag, or tap to resize'
      data-drag data-handle
      className='flex justify-center items-center shrink-0 cursor-grab'
      style={{ height: 32, touchAction: 'none' }}>
      <div className='w-10 h-1.5 rounded-full bg-gray-300' />
    </div>
    {/* Peeking, the whole sheet drags; otherwise its content scrolls, and
        overscroll-behavior keeps a scroll at the top from pulling the page
        (pull-to-refresh). */}
    <div className='px-3 pb-3' {...(peek ? { 'data-drag': '' } : {})}
      style={{ overflowY: peek ? 'hidden' : 'auto', overscrollBehavior: 'contain', touchAction: peek ? 'none' : 'pan-y' }}>{children}</div>
  </div>;
}
