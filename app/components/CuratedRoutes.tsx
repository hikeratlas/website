// Curated hikes on the map. The basemap's "route" layer (from
// hikeratlas/routes) highlights them; clicking one opens its details: the
// distance and climb, an elevation chart with campsites along the way, and
// what it passes. Each park's routes are in full in
// <TILES_ROOT>/routes/<build>/<park osm id>.json.
import { useEffect, useRef, useState } from 'react';
import { TILES_ROOT } from '~/build';
import { profile, type Profile } from '~/routing/elevation';
import type { LngLat } from '~/routing/graph';
import { ElevationChart, type Mark } from './RoutePlanner';

const LAYER = 'routes-route';
const EMPTY = { type: 'FeatureCollection', features: [] };
const COLOR = '#c026d3';

const parks = new Map<string, Promise<any>>();
function parkRoutes(build: string, park: string): Promise<any> {
  const url = `${TILES_ROOT}/routes/${build}/${park}.json`;
  if (!parks.has(url)) parks.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} fetching ${url}`)))));
  return parks.get(url)!;
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

// The route an id names: <park>/day/i, <park>/base/i (the walk in to a base
// camp), <park>/base/i/j (a day hike from it), or <park>/multi/i.
function lookup(doc: any, id: string): Selected | null {
  const [, type, i, j] = id.split('/');
  if (type === 'day') {
    const h = doc.day_hikes[+i];
    return h && { id, title: `${h.dest} from ${h.from}`, label: `Day hike · ${KIND[h.kind] ?? h.kind}`, route: h.route, why: h.why };
  }
  if (type === 'base') {
    const b = doc.base_camps[+i];
    if (!b) return null;
    if (j === undefined) return { id, title: `${b.camp}`, label: `Base camp · walk in from ${b.from}`, route: b.approach, base: b, baseIndex: +i };
    const h = b.hikes[+j];
    return h && { id, title: `${h.dest} from ${b.camp}`, label: `Day hike from base camp · ${KIND[h.kind] ?? h.kind}`, route: h.route, why: h.why, base: b, baseIndex: +i };
  }
  if (type === 'multi') {
    const t = doc.point_to_points[+i];
    return t && { id, title: `${t.from} to ${t.to}`, label: `Multi-day · ${KIND['point-to-point']}`, route: t.route };
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
    ...doc.day_hikes.map((h: any, i: number) => ({ park, id: `${park}/day/${i}`, title: `${h.dest} from ${h.from}`, meta: meta('day', h.route.km, h.route.gain) })),
    ...doc.base_camps.map((b: any, i: number) => ({ park, id: `${park}/base/${i}`, title: `Base camp: ${b.camp} from ${b.from}`, meta: `${b.hikes.length} day hikes from camp · walk in ${b.approach.km.toFixed(1)} km` })),
    ...doc.point_to_points.map((t: any, i: number) => ({ park, id: `${park}/multi/${i}`, title: `${t.from} to ${t.to}`, meta: meta('multi-day', t.route.km, t.route.gain) })),
  ];
}

export default function CuratedRoutes({ map, build, focusPark }: { map: any; build: string; focusPark?: { id: string; name: string; at: number } | null }) {
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

  const openList = (l: List) => { setList(l); setMode('list'); setError(null); };

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
      setProf(await profile(s.route.line));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  };

  const close = () => {
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

  // A park picked in search: list its routes, if it has any.
  useEffect(() => {
    if (!map || !focusPark) return;
    parkRoutes(build, focusPark.id)
      .then((doc) => openList({ heading: `Hikes in ${focusPark.name}`, items: itemsFromPark(doc) }))
      // Most parks have no curated routes; just close what was open.
      .catch(() => close());
  }, [map, build, focusPark]);

  if (!map) return null;

  const button = inView.length > 0 && mode === null && <button
    className='absolute top-3 bg-white rounded shadow px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50'
    style={{ zIndex: 2, left: 84 }}
    onClick={() => openList({ heading: `${inView.length} curated ${inView.length === 1 ? 'hike' : 'hikes'} in view`, items: inView })}
    title='Hikes picked for this area'
  >{inView.length} {inView.length === 1 ? 'hike' : 'hikes'} in view</button>;

  if (mode === null && !error) return button || null;

  const r = sel?.route;
  return <div
    className='absolute right-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm overflow-y-auto'
    style={{ zIndex: 2, width: 'min(480px, calc(100% - 24px))', maxHeight: 'calc(100% - 48px)' }}
  >
    <div className='flex items-start justify-between gap-2'>
      <div>
        {mode === 'detail' && list && <button className='text-blue-700 hover:underline mb-1' onClick={() => setMode('list')}>← {list.heading}</button>}
        {mode === 'list' && list && <div className='font-semibold text-base'>{list.heading}</div>}
        {mode === 'detail' && sel && <div className='font-semibold text-base'>{sel.title}</div>}
        {mode === 'detail' && sel && <div className='text-gray-600'>{sel.label}</div>}
        {error && <div className='text-red-700'>{error}</div>}
      </div>
      <button className='text-gray-500 hover:text-gray-900 leading-none text-lg' aria-label='Close' title='Close' onClick={close}>×</button>
    </div>
    {mode === 'list' && list && <ul className='mt-1'>
      {list.items.map((c) => <li key={c.id} className='py-0.5'>
        <button className='text-blue-700 hover:underline text-left' onClick={() => select(c.park, c.id)}>{c.title}</button>
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
              {h.dest}
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
  </div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className='mt-1'><span className='text-gray-500'>{label}: </span>{children}</div>;
}
