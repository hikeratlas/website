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

export default function CuratedRoutes({ map, build }: { map: any; build: string }) {
  const [sel, setSel] = useState<Selected | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Routes often share trail: a click on several offers a choice.
  const [choices, setChoices] = useState<{ park: string; id: string; title: string; km: number }[] | null>(null);
  const added = useRef(false);

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
    setChoices(null);
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
      const seen = new Set<string>();
      const found = at(e).map((f: any) => f.properties).filter((p: any) => !seen.has(p.id) && seen.add(p.id))
        .map((p: any) => ({ park: String(p.park_id), id: String(p.id), title: String(p.title), km: Number(p.km) }));
      if (found.length === 1) select(found[0].park, found[0].id);
      else if (found.length > 1) setChoices(found);
    };
    const onMove = (e: any) => {
      if (planning()) return;
      map.getCanvas().style.cursor = at(e).length ? 'pointer' : '';
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); };
  }, [map, build]);

  if (!map || (!sel && !error && !choices)) return null;

  const r = sel?.route;
  return <div
    className='absolute right-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm overflow-y-auto'
    style={{ zIndex: 2, width: 'min(480px, calc(100% - 24px))', maxHeight: 'calc(100% - 48px)' }}
  >
    <div className='flex items-start justify-between gap-2'>
      <div>
        {sel && <div className='font-semibold text-base'>{sel.title}</div>}
        {sel && <div className='text-gray-600'>{sel.label}</div>}
        {error && <div className='text-red-700'>{error}</div>}
      </div>
      <button className='text-gray-500 hover:text-gray-900 leading-none text-lg' aria-label='Close' title='Close' onClick={() => { close(); setError(null); setChoices(null); }}>×</button>
    </div>
    {choices && <div className={sel ? 'mb-2' : ''}>
      <div className='text-gray-600'>{choices.length} routes here:</div>
      <ul className='ml-1'>
        {choices.map((c) => <li key={c.id}>
          <button className='text-blue-700 hover:underline text-left' onClick={() => select(c.park, c.id)}>{c.title}</button>
          <span className='text-gray-500'> {c.km.toFixed(1)} km</span>
        </li>)}
      </ul>
    </div>}
    {r && <>
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
