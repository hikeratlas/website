// Curated hikes on the map. The basemap's "route" layer (from
// hikeratlas/routes) highlights them; clicking one opens its details: the
// distance and climb, an elevation chart with campsites along the way, and
// what it passes. Each park's routes are in full in a bundle,
// <TILES_ROOT>/routes/<build>/<bundle>: every park's JSON gzipped, end to end,
// located by <TILES_ROOT>/routes/<build>/index.json ({bundle, parks: {<park
// osm id>: [offset, length]}}), so a build uploads 2 files, not one per park.
// Builds from before the bundle have <TILES_ROOT>/routes/<build>/<park>.json.
import { useEffect, useRef, useState } from 'react';
import { TILES_ROOT } from '~/build';
import { profile, type Profile } from '~/routing/elevation';
import type { LngLat } from '~/routing/graph';
import { ElevationChart, type Mark } from './RoutePlanner';

const LAYER = 'routes-route';
const EMPTY = { type: 'FeatureCollection', features: [] };
const COLOR = '#c026d3';

interface BundleIndex {
  bundle: string;
  parks: Record<string, [number, number]>;
  // From hikeratlas/basemap's bin/hike-paths.py, in builds that have it:
  // park id -> "<country>/<state>/<park>", and country or state path -> name.
  paths?: Record<string, string>;
  regions?: Record<string, string>;
}

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

async function fetchPark(build: string, park: string): Promise<any> {
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

const parks = new Map<string, Promise<any>>();
export function parkRoutes(build: string, park: string): Promise<any> {
  const key = `${build}/${park}`;
  if (!parks.has(key)) parks.set(key, fetchPark(build, park));
  return parks.get(key)!;
}

interface Route {
  km: number;
  gain: number;
  max_ele: number;
  landcover: [string, number][];
  passes: [string, string[]][];
  stopovers: { name: string; km: number; at: LngLat }[];
  via: string[];
  line: LngLat[];
}

interface Selected {
  id: string;
  title: string;
  label: string;
  route: Route;
  why?: [string, number][];
  base?: any; // the base camp, for its walk in and day hikes from camp
  baseIndex?: number;
}

const KIND: Record<string, string> = { 'out-and-back': 'out and back', loop: 'loop', 'point-to-point': 'point to point (needs a shuttle)' };

// A route that follows an OSM hiking route carries its name (hikeratlas/routes'
// recall::name_routes): "Colchuck Lake Trail", not "Colchuck Lake from Stuart
// Lake Trailhead".
function named(r: any, otherwise: string): string {
  return typeof r.name === 'string' && r.name ? r.name : otherwise;
}

// The route an id names: <park>/day/i, <park>/base/i (the walk in to a base
// camp), <park>/base/i/j (a day hike from it), or <park>/multi/i.
function lookup(doc: any, id: string): Selected | null {
  const [, type, i, j] = id.split('/');
  if (type === 'day') {
    const h = doc.day_hikes[+i];
    return h && { id, title: named(h, `${h.dest} from ${h.from}`), label: `Day hike · ${KIND[h.kind] ?? h.kind}`, route: h.route, why: h.why };
  }
  if (type === 'base') {
    const b = doc.base_camps[+i];
    if (!b) return null;
    if (j === undefined) return { id, title: `${b.camp}`, label: `Base camp · walk in from ${b.from}`, route: b.approach, base: b, baseIndex: +i };
    const h = b.hikes[+j];
    return h && { id, title: named(h, `${h.dest} from ${b.camp}`), label: `Day hike from base camp · ${KIND[h.kind] ?? h.kind}`, route: h.route, why: h.why, base: b, baseIndex: +i };
  }
  if (type === 'multi') {
    const t = doc.point_to_points[+i];
    return t && { id, title: named(t, `${t.from} to ${t.to}`), label: `Multi-day · ${KIND['point-to-point']}`, route: t.route };
  }
  return null;
}

// A route in a list: the routes under a click, in view, or in a park.
interface Item { park: string; id: string; title: string; meta: string }
interface List { heading: string; items: Item[] }

const TYPE_LABEL: Record<string, string> = { day: 'Day hike', approach: 'Base camp', 'multi-day': 'Multi-day', 'from-camp': 'From camp' };
const TYPE_ORDER: Record<string, number> = { day: 0, approach: 1, 'multi-day': 2, 'from-camp': 3 };

function meta(type: string, km: number, gain: number): string {
  return `${TYPE_LABEL[type] ?? type} · ${km.toFixed(1)} km · ↑ ${Math.round(gain).toLocaleString()} m`;
}

// Items from the route layer's features (properties as in hikeratlas/routes'
// routes.geojsonl), one per route, best first within each park.
function itemsFromFeatures(features: any[], fromCamp = true): Item[] {
  const seen = new Map<string, any>();
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
function itemsFromPark(doc: any): Item[] {
  const park = String(doc.park.id);
  return [
    ...doc.day_hikes.map((h: any, i: number) => ({ park, id: `${park}/day/${i}`, title: named(h, `${h.dest} from ${h.from}`), meta: meta('day', h.route.km, h.route.gain) })),
    ...doc.base_camps.map((b: any, i: number) => ({ park, id: `${park}/base/${i}`, title: `Base camp: ${b.camp} from ${b.from}`, meta: `${b.hikes.length} day hikes from camp · walk in ${b.approach.km.toFixed(1)} km` })),
    ...doc.point_to_points.map((t: any, i: number) => ({ park, id: `${park}/multi/${i}`, title: named(t, `${t.from} to ${t.to}`), meta: meta('multi-day', t.route.km, t.route.gain) })),
  ];
}

// A park picked in search (list its hikes), or with route, a hike picked in
// search (open it): route is its id, as select() takes.
export interface FocusPark { id: string; name: string; at: number; route?: string }

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
export interface RegionList { heading: string; items: { name: string; path: string; meta: string }[] }

export interface Crumb { name: string; href: string; path: string }

interface Props {
  map: any;
  build: string;
  focusPark?: FocusPark | null;
  onShowing?: (s: Showing) => void;
  // Breadcrumbs for what's showing, and where clicking one goes.
  crumbs?: Crumb[];
  region?: RegionList | null;
  onNavigate?: (path: string) => void;
  // Closes the panel when it changes (Back to /map).
  closeAt?: number;
  // A note above the panel's content ("That hike has changed...").
  note?: string | null;
}

export default function CuratedRoutes({ map, build, focusPark, onShowing, crumbs, region, onNavigate, closeAt, note }: Props) {
  const [sel, setSel] = useState<Selected | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A list of routes to pick from (see Item), and whether it's showing or a
  // route's details are.
  const [list, setList] = useState<List | null>(null);
  const [mode, setMode] = useState<'list' | 'detail' | null>(null);
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
  const openList = (l: List, park: { id: string; name: string } | null = null) => {
    setList(l); setMode('list'); setError(null); setSnap('half'); setListPark(park);
  };

  const setData = (id: string, data: any) => map?.getSource(id)?.setData(data);

  const addLayers = () => {
    if (added.current) return;
    added.current = true;
    map.addSource('curated-sel', { type: 'geojson', data: EMPTY });
    map.addSource('curated-hover', { type: 'geojson', data: EMPTY });
    const round = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'curated-sel-casing', type: 'line', source: 'curated-sel', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: 'curated-sel', type: 'line', source: 'curated-sel', layout: round, paint: { 'line-color': COLOR, 'line-width': 4 } });
    map.addLayer({
      id: 'curated-stops', type: 'circle', source: 'curated-sel', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#16a34a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    });
    map.addLayer({ id: 'curated-hover', type: 'circle', source: 'curated-hover', paint: { 'circle-radius': 6, 'circle-color': '#0b0b0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
  };

  const select = async (park: string, id: string) => {
    setError(null);
    setMode('detail');
    setSnap('peek');
    try {
      const doc = await parkRoutes(build, park);
      const s = lookup(doc, id);
      if (!s) { setError('That route is no longer available.'); return; }
      // A day hike from a base camp starts at the camp; don't list it as a stop.
      if (s.base && id.split('/').length === 4) s.route = { ...s.route, stopovers: s.route.stopovers.filter((c) => c.name !== s.base.camp) };
      addLayers();
      setSel(s);
      setProf(null);
      setData('curated-sel', {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.route.line } },
          ...s.route.stopovers.map((c) => ({ type: 'Feature', properties: { name: c.name }, geometry: { type: 'Point', coordinates: c.at } })),
        ],
      });
      if (window.matchMedia(PHONE).matches) fitAbove(map, s.route.line, PEEK_PX);
      setProf(await profile(s.route.line));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  };

  const close = () => {
    setListPark(null);
    setSel(null);
    setProf(null);
    setList(null);
    setMode(null);
    setError(null);
    setData('curated-sel', EMPTY);
    setData('curated-hover', EMPTY);
  };

  useEffect(() => {
    if (!map) return;
    // The route planner takes over clicks while it's active (crosshair).
    const planning = () => map.getCanvas().style.cursor === 'crosshair';
    const at = (e: any) => {
      if (!map.getLayer(LAYER)) return [];
      const { x, y } = e.point;
      return map.queryRenderedFeatures([[x - 4, y - 4], [x + 4, y + 4]], { layers: [LAYER] });
    };
    const onClick = (e: any) => {
      if (planning()) return;
      const found = itemsFromFeatures(at(e));
      if (found.length === 1) { setList(null); select(found[0].park, found[0].id); }
      else if (found.length > 1) openList({ heading: `${found.length} routes here`, items: found });
    };
    const onMove = (e: any) => {
      if (planning()) return;
      map.getCanvas().style.cursor = at(e).length ? 'pointer' : '';
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
  }, [map, build]);

  // A park picked in search: list its routes, if it has any. A hike picked
  // in search (#44): open it.
  useEffect(() => {
    if (!map || !focusPark) return;
    if (focusPark.route) {
      // As if from the park's list, so "←" goes back to it.
      parkRoutes(build, focusPark.id)
        .then((doc) => { setList({ heading: `Hikes in ${doc.park?.name ?? focusPark.name}`, items: itemsFromPark(doc) }); setListPark({ id: focusPark.id, name: doc.park?.name ?? focusPark.name }); })
        .catch(() => {});
      select(focusPark.id, focusPark.route);
      return;
    }
    parkRoutes(build, focusPark.id)
      .then((doc) => openList({ heading: `Hikes in ${doc.park?.name ?? focusPark.name}`, items: itemsFromPark(doc) }, { id: focusPark.id, name: doc.park?.name ?? focusPark.name }))
      // Most parks have no curated routes; just close what was open.
      .catch(() => close());
  }, [map, build, focusPark]);

  // Tell the page what's showing, for its URL.
  useEffect(() => {
    if (!onShowing) return;
    if (mode === 'detail' && sel) onShowing({ type: 'hike', park: sel.id.split('/')[0], id: sel.id, title: sel.title });
    else if (mode === 'list' && listPark) onShowing({ type: 'park', park: listPark.id, name: listPark.name });
    else if (mode === 'list') onShowing({ type: 'other' });
    else if (mode === null && !error) onShowing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sel?.id, listPark?.id]);

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
      <div className='flex items-start justify-between gap-2' data-drag style={phone ? { touchAction: 'none' } : undefined}>
        <div>
          {trail}
          <h2 className='font-semibold text-base'>{region.heading}</h2>
        </div>
        <button className='tap text-gray-500 hover:text-gray-900 leading-none text-lg' aria-label='Close' title='Close' onClick={() => onNavigate?.('/map')}>×</button>
      </div>
      {note && <div className='text-gray-600 mt-1'>{note}</div>}
      <ul className='mt-1'>
        {region.items.map((c) => <li key={c.path} className='py-0.5'>
          <a href={c.path} className='tap-row text-blue-700 hover:underline' onClick={(e) => { if (onNavigate && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onNavigate(c.path); } }}>{c.name}</a>
          <div className='text-gray-500 text-xs'>{c.meta}</div>
        </li>)}
      </ul>
    </Sheet>;
  }

  if (mode === null && !error) return button || null;

  const r = sel?.route;
  return <Sheet phone={phone} snap={snap} setSnap={setSnap}>
    {/* data-drag: on a phone, dragging the header row moves the sheet. */}
    <div className='flex items-start justify-between gap-2' data-drag style={phone ? { touchAction: 'none' } : undefined}>
      <div>
        {trail}
        {(!trail || !listPark) && mode === 'detail' && list && <button className='tap text-blue-700 hover:underline mb-1 text-left' onClick={() => setMode('list')}>← {list.heading}</button>}
        {mode === 'list' && list && <div className='font-semibold text-base'>{list.heading}</div>}
        {mode === 'detail' && sel && <div className='font-semibold text-base'>{sel.title}</div>}
        {mode === 'detail' && sel && <div className='text-gray-600'>{sel.label}</div>}
        {error && <div className='text-red-700'>{error}</div>}
        {note && <div className='text-gray-600'>{note}</div>}
      </div>
      <button className='tap text-gray-500 hover:text-gray-900 leading-none text-lg' aria-label='Close' title='Close' onClick={close}>×</button>
    </div>
    {mode === 'list' && list && <ul className='mt-1'>
      {list.items.map((c) => <li key={c.id} className='py-0.5'>
        <button className='tap-row text-blue-700 hover:underline text-left' onClick={() => select(c.park, c.id)}>{c.title}</button>
        <div className='text-gray-500 text-xs'>{c.meta}</div>
      </li>)}
    </ul>}
    {mode === 'detail' && r && <>
      <div className='mt-1'>
        {r.km} km · ↑ {Math.round(r.gain).toLocaleString()} m · high point {Math.round(r.max_ele).toLocaleString()} m
      </div>
      {prof
        ? <ElevationChart
            points={prof.points}
            lo={Math.min(...prof.points.map(([, e]) => e))}
            hi={Math.max(...prof.points.map(([, e]) => e))}
            marks={r.stopovers.map((c): Mark => ({ at: c.km * 1000, label: c.name }))}
            onHover={(i) => setData('curated-hover', i === null ? EMPTY : { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: prof.coords[i] } })}
          />
        : <div className='h-[120px] text-gray-400 flex items-center'>Measuring elevation…</div>}
      {r.stopovers.length > 0 && <Row label={sel?.base && !sel.id.split('/')[3] ? 'Camp' : 'Campsites'}>
        {r.stopovers.map((c) => `${c.name} (${c.km} km)`).join(', ')}
      </Row>}
      {r.via.length > 0 && <Row label='Via'>{r.via.slice(0, 6).join(', ')}{r.via.length > 6 ? '…' : ''}</Row>}
      {r.passes.length > 0 && <Row label='Passes'>{r.passes.map(([k, names]) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`).join('; ')}</Row>}
      {r.landcover.length > 0 && <Row label='Terrain'>{r.landcover.filter(([, s]) => s >= 0.05).map(([k, s]) => `${k} ${Math.round(s * 100)}%`).join(', ')}</Row>}
      {sel?.base && <div className='mt-2'>
        <div className='text-gray-600'>From {sel.base.camp}:</div>
        <ul className='ml-1'>
          {sel.base.hikes.map((h: any, j: number) => <li key={j}>
            <button className='text-blue-700 hover:underline text-left' onClick={() => select(sel.id.split('/')[0], `${sel.id.split('/')[0]}/base/${sel.baseIndex}/${j}`)}>
              {named(h, h.dest)}
            </button> <span className='text-gray-500'>{h.route.km} km · ↑ {Math.round(h.route.gain)} m</span>
          </li>)}
          <li><button className='text-blue-700 hover:underline' onClick={() => select(sel.id.split('/')[0], `${sel.id.split('/')[0]}/base/${sel.baseIndex}`)}>The walk in</button></li>
        </ul>
      </div>}
      {sel?.why && <details className='mt-2 text-gray-500'>
        <summary className='cursor-pointer'>Why this route</summary>
        <div className='mt-1'>{sel.why.map(([k, v]) => `${k.replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${v}`).join(' · ')}</div>
      </details>}
    </>}
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
    return <a href={parent.href} onClick={go(parent)} className='tap text-blue-700 hover:underline text-sm block mb-0.5'>‹ {parent.name}</a>;
  }
  return <nav aria-label='Breadcrumb' className='text-xs text-gray-600 mb-0.5'>
    <ol className='flex flex-wrap gap-x-1'>
      {crumbs.map((c, i) => <li key={c.path} className='flex gap-x-1'>
        {i > 0 && <span aria-hidden='true'>›</span>}
        {i < crumbs.length - 1
          ? <a href={c.href} onClick={go(c)} className='text-blue-700 hover:underline'>{c.name}</a>
          : <span aria-current='page'>{c.name}</span>}
      </li>)}
    </ol>
  </nav>;
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

// Fit a route into the part of the map a bottom sheet of `bottom` px leaves.
function fitAbove(map: any, line: [number, number][], bottom: number) {
  if (line.length < 2) return;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of line) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  map.fitBounds([[w, s], [e, n]], { padding: { top: 70, bottom: bottom + 20, left: 30, right: 30 }, duration: 600, maxZoom: 15 });
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className='mt-1'><span className='text-gray-500'>{label}: </span>{children}</div>;
}
