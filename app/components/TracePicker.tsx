// The trace picker, for hikeratlas/routes' named regressions: for each trail
// a park lists, pick which of the hikes routes considered is the one meant,
// or draw it by clicking along it (routed along trails, as the map's route
// planner does). Each pick becomes the regression's `trace`.
//
// It reads the JSON routes' fixtures/picker-data.py writes, dropped on the
// page, and keeps it and the picks in this browser. "Copy picks" gives the
// JSON fixtures/apply-picks.py writes back into fixtures/expect/.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Feature, FeatureCollection, Geometry, LineString } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import Map from '~/components/Map';
import { styleUrl, tilesUrl } from '~/build';
import { useWaypoints } from '~/components/useWaypoints';
import type { LngLat } from '~/routing/graph';

interface CandProps { from: string; dest: string; kind: string; km: number; score: number; picked: boolean; on_trail: number; name?: string | null }
interface Entry {
  id: string; name: string; km: number; why: string; source: string; issue: string; osm_trail: string;
  bbox: [number, number, number, number];
  trail: Geometry | null;
  candidates: Feature<LineString, CandProps>[];
  trace?: LngLat[] | null;
}
interface Data { park: string; park_id: string; entries: Entry[] }
interface Pick { mode: 'candidate' | 'drawn' | 'none'; line: LngLat[]; points?: LngLat[]; label?: string; km?: number; note: string }

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const DRAW = '#7c3aed', CAND = '#2563eb', SEL = '#dc2626', TRAIL = '#f59e0b';
const DATA_KEY = 'trace-picker:data';
const picksKey = (park: string) => `trace-picker:picks:${park}`;

function load<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}
// The bounds of any geometry's coordinates.
function bounds(g: Geometry): [[number, number], [number, number]] {
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ('coordinates' in g) walk(g.coordinates);
  return [[w, so], [e, n]];
}
const candName = (p: CandProps) => {
  const leg = p.dest && p.dest !== p.from ? `${p.from} → ${p.dest}` : p.from;
  return p.name ? `${p.name} (${leg})` : leg;
};

export default function TracePicker({ build }: { build: string | null }) {
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const draw = useWaypoints(map, tilesUrl(build ?? 'north-america'), { id: 'trace-draw', color: DRAW, active: drawing });

  // What was loaded last time, and its picks.
  useEffect(() => {
    const d = load<Data>(DATA_KEY);
    if (d) { setData(d); setPicks(load<Record<string, Pick>>(picksKey(d.park_id)) ?? {}); }
  }, []);

  const entry = data?.entries[cur] ?? null;

  const open = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as Data;
      if (!d.entries?.length) throw new Error('no entries in it');
      // The map draws the trails itself: picker-data.py's own map isn't needed.
      const slim: Data = { park: d.park, park_id: d.park_id, entries: d.entries };
      setData(slim); setCur(0); setSel(null); setDrawing(false); draw.clear();
      setPicks(load<Record<string, Pick>>(picksKey(slim.park_id)) ?? {});
      setMsg(save(DATA_KEY, slim) ? null : 'Loaded, but too big to keep in this browser: drop it again after a reload.');
    } catch (e) {
      setMsg(`That isn't picker-data.py's JSON: ${(e as Error).message}`);
    }
  };

  // The map's layers for the entry: the OSM trail of its name, its candidates.
  const addLayers = useCallback(() => {
    if (!map || map.getSource('tp-trail')) return;
    map.addSource('tp-trail', { type: 'geojson', data: EMPTY });
    map.addSource('tp-cands', { type: 'geojson', data: EMPTY, promoteId: 'i' });
    map.addSource('tp-trace', { type: 'geojson', data: EMPTY });
    const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
    map.addLayer({ id: 'tp-trail', type: 'line', source: 'tp-trail', layout: round, paint: { 'line-color': TRAIL, 'line-width': 12, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'tp-trace', type: 'line', source: 'tp-trace', layout: round, paint: { 'line-color': DRAW, 'line-width': 3, 'line-dasharray': [1, 2] } });
    map.addLayer({ id: 'tp-cands', type: 'line', source: 'tp-cands', layout: round, paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], SEL, CAND],
      'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 6, ['boolean', ['feature-state', 'hover'], false], 5, 3],
      'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, ['boolean', ['feature-state', 'hover'], false], 1, 0.6],
    } });
    // Drawn routes on top.
    for (const id of ['trace-draw-line-casing', 'trace-draw-line', 'trace-draw-points']) if (map.getLayer(id)) map.moveLayer(id);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
  }, [map, addLayers]);

  // Show the entry, and restore its pick.
  useEffect(() => {
    if (!map || !entry) return;
    const show = () => {
      addLayers();
      map.getSource<GeoJSONSource>('tp-trail')?.setData(entry.trail ? { type: 'Feature', properties: {}, geometry: entry.trail } : EMPTY);
      map.getSource<GeoJSONSource>('tp-cands')?.setData({ type: 'FeatureCollection',
        features: entry.candidates.map((c, i) => ({ ...c, properties: { ...c.properties, i } })) });
      map.getSource<GeoJSONSource>('tp-trace')?.setData(entry.trace ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: entry.trace } } : EMPTY);
      // The OSM trail of its name, where there is one: the candidates can
      // range far wider.
      const b = entry.bbox;
      map.fitBounds(entry.trail ? bounds(entry.trail) : [[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 15, duration: 0 });
    };
    if (map.isStyleLoaded()) show(); else map.once('load', show);
    const p = picks[entry.id];
    setNote(p?.note ?? '');
    setDrawing(false);
    const i = p?.mode === 'candidate' ? entry.candidates.findIndex((c) => candName(c.properties) === p.label && c.properties.km === p.km) : -1;
    setSel(i >= 0 ? i : null);
    if (p?.mode === 'drawn' && p.points?.length) draw.set(p.points); else draw.clear();
  }, [map, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  // The selected candidate, as feature state.
  useEffect(() => {
    if (!map || !entry || !map.getSource('tp-cands')) return;
    entry.candidates.forEach((_, i) => map.setFeatureState({ source: 'tp-cands', id: i }, { sel: i === sel }));
  }, [map, entry, sel]);

  // Clicking or hovering a candidate on the map, unless drawing.
  useEffect(() => {
    if (!map || drawing) return;
    let hovered: number | null = null;
    const unhover = () => { if (hovered !== null) map.setFeatureState({ source: 'tp-cands', id: hovered }, { hover: false }); hovered = null; };
    const onMove = (e: MapLayerMouseEvent) => {
      const i = e.features?.[0]?.id as number | undefined;
      if (i === undefined || i === hovered) return;
      unhover(); hovered = i;
      map.setFeatureState({ source: 'tp-cands', id: i }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => { unhover(); map.getCanvas().style.cursor = ''; };
    const onClick = (e: MapLayerMouseEvent) => {
      const i = e.features?.[0]?.id as number | undefined;
      if (i !== undefined) setSel((s) => (s === i ? null : i));
    };
    map.on('mousemove', 'tp-cands', onMove);
    map.on('mouseleave', 'tp-cands', onLeave);
    map.on('click', 'tp-cands', onClick);
    return () => { map.off('mousemove', 'tp-cands', onMove); map.off('mouseleave', 'tp-cands', onLeave); map.off('click', 'tp-cands', onClick); unhover(); };
  }, [map, drawing]);

  const store = (p: Pick | null) => {
    if (!entry || !data) return;
    const next = { ...picks };
    if (p) next[entry.id] = p; else delete next[entry.id];
    setPicks(next);
    save(picksKey(data.park_id), next);
  };
  const savePick = () => {
    if (!entry) return;
    if (drawing || draw.coords.length > 1) {
      if (draw.coords.length < 2) return;
      store({ mode: 'drawn', line: draw.coords.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]), points: draw.points,
        km: Math.round(draw.metres / 100) / 10, note: note.trim() });
      setDrawing(false);
      return;
    }
    if (sel === null) return;
    const c = entry.candidates[sel];
    store({ mode: 'candidate', line: c.geometry.coordinates as LngLat[], label: candName(c.properties), km: c.properties.km, note: note.trim() });
  };

  const exportJson = useMemo(() => data ? JSON.stringify(data.entries.filter((e) => picks[e.id]).map((e) => {
    const p = picks[e.id];
    return { entry: e.id, name: e.name, mode: p.mode, line: p.line, note: p.note };
  })) : '[]', [data, picks]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(exportJson); setCopied('Copied: paste it to Claude, or into fixtures/apply-picks.py.'); }
    catch { setCopied('Couldn’t copy: select the text below and copy it.'); }
  };

  const nPicked = data ? data.entries.filter((e) => picks[e.id]).length : 0;
  const p = entry ? picks[entry.id] : undefined;
  const canSave = drawing || draw.coords.length > 1 ? draw.coords.length > 1 && !draw.busy : sel !== null;
  const btn = 'tap px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40';

  return <div className='flex flex-col md:flex-row h-screen'>
    <aside className='md:w-[380px] md:h-full h-1/2 overflow-y-auto border-r border-gray-200 bg-white p-3 text-sm flex flex-col gap-3 order-2 md:order-1'
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) open(f); }}>
      <div>
        <div className='text-lg font-semibold'>{data ? data.park : 'Trace picker'}</div>
        <div className='text-gray-500 text-xs'>For routes’ named regressions: pick the hike each trail entry means, or draw it.</div>
      </div>
      <label className='text-xs text-gray-600'>
        {data ? 'Open another park: ' : 'Open a park’s picker JSON (from routes’ fixtures/picker-data.py), or drop it here: '}
        <input type='file' accept='.json,application/json' className='block mt-1 text-xs' onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); }} />
      </label>
      {msg && <div className='text-amber-700 text-xs'>{msg}</div>}
      {data && entry && <>
        <div className='flex flex-wrap gap-1.5'>
          {data.entries.map((e, i) => <button key={e.id} type='button' onClick={() => setCur(i)}
            className={`tap px-2.5 py-0.5 rounded-full border text-xs ${i === cur ? 'bg-emerald-800 border-emerald-800 text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${picks[e.id] ? 'bg-emerald-500' : 'bg-gray-300'}`} />{e.name}</button>)}
        </div>
        <div>
          <div className='font-semibold text-base'>{entry.name}</div>
          <div>The park says <b>{entry.km} km</b>. {entry.why}</div>
          {entry.source && <a className='text-emerald-800 underline text-xs break-all' href={entry.source} target='_blank' rel='noreferrer'>{entry.source.replace(/^https?:\/\/(www\.)?/, '')}</a>}
          <div className='text-gray-500 text-xs'>{entry.issue} · OSM trail: {entry.trail ? entry.osm_trail : 'none of this name'}{entry.trace ? ' · has a trace already (dotted)' : ''}</div>
        </div>
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600'>
          <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: TRAIL }} />OSM trail of this name</span>
          <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: CAND }} />candidate</span>
          <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: SEL }} />picked</span>
          <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: DRAW }} />drawn</span>
        </div>
        <div className='flex flex-col gap-1.5 border border-gray-200 rounded p-2'>
          <div className='flex items-center gap-1.5 flex-wrap'>
            <button type='button' className={drawing ? `${btn} !bg-violet-700 !border-violet-700 !text-white` : btn}
              onClick={() => { setDrawing(!drawing); setSel(null); }}>{drawing ? 'Drawing: click along the hike' : 'Draw it instead'}</button>
            <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.undo}>Undo point</button>
            <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.clear}>Clear</button>
          </div>
          {(drawing || draw.points.length > 0) && <div className='text-xs text-gray-600'>
            {draw.error ?? (draw.busy ? 'Routing…' : draw.points.length < 2 ? 'Click where the hike starts, then along it: each click is routed along trails from the one before.' : `${(draw.metres / 1000).toFixed(1)} km through ${draw.points.length} points.`)}
          </div>}
        </div>
        <div>
          <div className='text-xs uppercase tracking-wide text-gray-500 mb-1'>Hikes routes considered here</div>
          <ol className='flex flex-col gap-1'>
            {entry.candidates.map((c, i) => <li key={i}><button type='button' onClick={() => {
              setDrawing(false); setSel(sel === i ? null : i);
              if (sel !== i) map?.fitBounds(bounds(c.geometry), { padding: 60, maxZoom: 15 });
            }}
              className={`tap w-full text-left rounded border px-2 py-1.5 ${sel === i ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-blue-400'}`}>
              <div className='flex justify-between gap-2'><span className='font-medium break-words min-w-0'>{candName(c.properties)}</span><span className='tabular-nums whitespace-nowrap'>{c.properties.km} km</span></div>
              <div className='text-xs text-gray-500'>{c.properties.kind}{c.properties.picked ? ' · offered today' : ''} · {Math.round(c.properties.on_trail * 100)}% of the OSM trail · score {c.properties.score}</div>
            </button></li>)}
            {!entry.candidates.length && <li className='text-gray-500 text-xs'>No candidates near this trail: draw it.</li>}
          </ol>
        </div>
        <div className='flex flex-col gap-1.5 border-t border-gray-200 pt-2 sticky bottom-0 bg-white'>
          <input className='border border-gray-300 rounded px-2 py-1 text-sm' placeholder='Note (optional): e.g. the park measures the loop only'
            value={note} onChange={(e) => setNote(e.target.value)} />
          <div className='flex gap-1.5'>
            <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={!canSave} onClick={savePick}>Save this pick</button>
            <button type='button' className={btn} onClick={() => store({ mode: 'none', line: [], note: note.trim() })}>None of these</button>
            {p && <button type='button' className={btn} onClick={() => store(null)}>Forget</button>}
          </div>
          <div className='text-xs text-gray-600'>{p ? <>Saved: <b>{p.mode === 'none' ? 'none of these' : p.mode === 'drawn' ? `drawn, ${p.km} km` : `${p.label} (${p.km} km)`}</b>{p.note ? ` · ${p.note}` : ''}</> : 'Not picked yet.'}</div>
          <div className='flex items-center gap-2'>
            <button type='button' className={btn} disabled={!nPicked} onClick={copy}>Copy picks ({nPicked} of {data.entries.length})</button>
            {copied && <span className='text-xs text-gray-600'>{copied}</span>}
          </div>
          {copied?.startsWith('Couldn') && <textarea readOnly className='text-xs border border-gray-300 rounded p-1 h-24' value={exportJson} onFocus={(e) => e.currentTarget.select()} />}
        </div>
      </>}
    </aside>
    <div className='relative flex-1 order-1 md:order-2 min-h-0'>
      <Map style={styleUrl(build)} lng={-81.4} lat={46.0} zoom={11} onInitialized={setMap} />
    </div>
  </div>;
}
