// A route drawn by clicking points on the map: each click is routed along
// trails and roads from the one before (see app/routing/), the last point can
// be undone, and any point can be dragged (mouse or touch), re-routing the
// legs either side of it. Its start and end are labelled. Used by the map's
// route planner and the named-regressions page (routes/dev.regressions.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, LineLayerSpecification, MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent } from 'maplibre-gl';
import { withZstd, type Decompress } from '~/zstd';
import { Z, buildGraph, haversine, lngLatToTile, shortestPath, snapPair, tilesAround, worldToLngLat, type LngLat } from '~/routing/graph';
import { CoalescingSource, type Source } from '~/routing/source';

declare const pmtiles: {
  FetchSource: new (url: string) => Source;
  PMTiles: new (source: string | Source, cache?: unknown, decompress?: Decompress) => {
    decompress: Decompress;
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
  };
};
type Archive = InstanceType<typeof pmtiles.PMTiles>;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const START_COLOR = '#15803d', END_COLOR = '#b91c1c';
// The basemap style's label font (its glyphs are what the map can draw).
export const LABEL_FONT = ['Hubot Sans-Regular'];
// A route whose ends are this close is a loop or an out-and-back: one marker.
const SAME_END_M = 30;

// The start and end of a line, as labelled points: "Start" and "End", or one
// "Start · End" where it comes back to where it started. `prefix` names them
// ("Trace start"); `extra` is copied onto each feature.
export function endFeatures(line: LngLat[], prefix = '', extra: Record<string, unknown> = {}): GeoJSON.Feature[] {
  if (!line.length) return [];
  const a = line[0], b = line[line.length - 1];
  const name = (s: string) => (prefix ? `${prefix} ${s.toLowerCase()}` : s);
  const same = line.length < 2 || haversine(a, b) <= SAME_END_M;
  const f = (p: LngLat, role: string, label: string): GeoJSON.Feature => ({ type: 'Feature', properties: { role, label, color: role === 'end' ? END_COLOR : START_COLOR, ...extra }, geometry: { type: 'Point', coordinates: p } });
  return same ? [f(a, 'start', prefix ? `${prefix} start · end` : 'Start · End')]
    : [f(a, 'start', name('Start')), f(b, 'end', name('End'))];
}

interface Leg { coords: LngLat[]; metres: number }

export interface Waypoints {
  // The clicked points, in order.
  points: LngLat[];
  // The route through them, along trails: empty until there are two.
  coords: LngLat[];
  metres: number;
  // Whether a leg is being routed.
  busy: boolean;
  // Why the last leg couldn't be routed, if it couldn't.
  error: string | null;
  undo: () => void;
  clear: () => void;
  // Replace the points (and route them), e.g. to restore a saved route.
  set: (points: LngLat[]) => Promise<void>;
  // Move point i to p, re-routing the legs either side (what dragging does).
  move: (i: number, p: LngLat) => Promise<void>;
}

// `id` prefixes the map sources and layers it adds; `active` is whether
// clicks on the map add points.
export function useWaypoints(map: MaplibreMap | null, tiles: string, opts: { id: string; color: string; active: boolean }): Waypoints {
  const { id, color, active } = opts;
  const [points, setPoints] = useState<LngLat[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The work queue: legs are routed one at a time, in click order, so an
  // undo or a fast second click waits for the leg before it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const state = useRef<{ points: LngLat[]; legs: Leg[] }>({ points: [], legs: [] });
  const source = useRef<Archive | null>(null);
  const sourceFor = useRef<string | null>(null);

  const ensureSource = useCallback(() => {
    if (source.current && sourceFor.current === tiles) return;
    const decompress = withZstd(new pmtiles.PMTiles("").decompress);
    source.current = new pmtiles.PMTiles(new CoalescingSource(new pmtiles.FetchSource(tiles)), undefined, decompress);
    sourceFor.current = tiles;
  }, [tiles]);

  const layers = useRef(false);
  const addLayers = useCallback(() => {
    if (!map || layers.current) return;
    layers.current = true;
    map.addSource(`${id}-line`, { type: 'geojson', data: EMPTY });
    map.addSource(`${id}-points`, { type: 'geojson', data: EMPTY });
    const round: LineLayerSpecification['layout'] = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: `${id}-line-casing`, type: 'line', source: `${id}-line`, layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: `${id}-line`, type: 'line', source: `${id}-line`, layout: round, paint: { 'line-color': color, 'line-width': 4 } });
    // Points: the start green, the end red, the rest the route's colour; a
    // wide invisible ring under each takes a finger's drag on a phone.
    map.addLayer({ id: `${id}-hit`, type: 'circle', source: `${id}-points`, paint: { 'circle-radius': 18, 'circle-color': '#000000', 'circle-opacity': 0 } });
    map.addLayer({ id: `${id}-points`, type: 'circle', source: `${id}-points`, paint: {
      'circle-radius': ['match', ['get', 'role'], 'via', 6, 8],
      'circle-color': ['match', ['get', 'role'], 'start', START_COLOR, 'end', END_COLOR, color],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: `${id}-labels`, type: 'symbol', source: `${id}-points`, filter: ['!=', ['get', 'role'], 'via'], layout: {
      'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': ['match', ['get', 'role'], 'end', END_COLOR, START_COLOR], 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
  }, [map, id, color]);

  useEffect(() => {
    if (!map) return;
    if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers);
  }, [map, addLayers]);

  // Memoized: a new array each render would re-fire effects that depend on it.
  const coords = useMemo(() => legs.flatMap((l, i) => (i ? l.coords.slice(1) : l.coords)), [legs]);
  const metres = useMemo(() => legs.reduce((s, l) => s + l.metres, 0), [legs]);

  // Draw what's in state.
  useEffect(() => {
    if (!map || !layers.current) return;
    map.getSource<GeoJSONSource>(`${id}-line`)?.setData(coords.length
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY);
    map.getSource<GeoJSONSource>(`${id}-points`)?.setData(pointsData(points));
  }, [map, id, points, legs]); // eslint-disable-line react-hooks/exhaustive-deps

  // The points as features: each with its index `i` and `role` (start, end,
  // via, or start for both where the route comes back to its start), and
  // the start and end labelled.
  const pointsData = (ps: LngLat[]): FeatureCollection => {
    const loop = ps.length > 2 && haversine(ps[0], ps[ps.length - 1]) <= SAME_END_M;
    return {
      type: 'FeatureCollection',
      features: ps.map((p, i): GeoJSON.Feature => {
        const role = i === 0 ? 'start' : i === ps.length - 1 ? (loop ? 'via' : 'end') : 'via';
        const label = i === 0 ? (loop ? 'Start · End' : 'Start') : role === 'end' ? 'End' : '';
        return { type: 'Feature', properties: { i, role, label }, geometry: { type: 'Point', coordinates: p } };
      // Drawn in order: the start last, so on a loop its green marker sits
      // on top of the end that shares its place.
      }).sort((a, b) => Number(a.properties!.role === 'start') - Number(b.properties!.role === 'start')),
    };
  };

  const commit = () => { setPoints([...state.current.points]); setLegs([...state.current.legs]); };

  // A leg from the end of the route so far (or the previous point) to p.
  const routeLeg = useCallback(async (from: LngLat, to: LngLat): Promise<Leg | null> => {
    ensureSource();
    const g = await buildGraph(source.current!, tilesAround(from, to));
    const found = shortestPath(g, ...snapPair(g, from, to));
    if (!found) return null;
    return { coords: found.path.map((i) => worldToLngLat(g, i)), metres: found.metres };
  }, [ensureSource]);

  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(async () => {
      setBusy(true);
      try { await job(); } catch (e) { setError((e as Error).message ?? String(e)); }
      finally { setBusy(false); commit(); }
    });
    return queue.current;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback((p: LngLat) => enqueue(async () => {
    const s = state.current;
    setError(null);
    if (!s.points.length) {
      s.points.push(p);
      // Warm up: the tile under the start reads the archive's header and
      // the directory for the area, which routing will need.
      ensureSource();
      const [x, y] = lngLatToTile(p[0], p[1], Z);
      source.current!.getZxy(Z, Math.floor(x), Math.floor(y)).catch(() => {});
      return;
    }
    const last = s.legs.length ? s.legs[s.legs.length - 1].coords.at(-1)! : s.points[s.points.length - 1];
    const leg = await routeLeg(last, p);
    if (!leg) { setError('No route to that point on trails or roads.'); return; }
    // Points sit where they snapped to the trails, not where clicked.
    if (!s.legs.length) s.points[0] = leg.coords[0];
    s.points.push(leg.coords.at(-1)!);
    s.legs.push(leg);
  }), [enqueue, ensureSource, routeLeg]);

  const undo = useCallback(() => { enqueue(async () => {
    const s = state.current;
    setError(null);
    if (s.points.length > 1) s.legs.pop();
    s.points.pop();
  }); }, [enqueue]);

  const clear = useCallback(() => { enqueue(async () => {
    state.current = { points: [], legs: [] };
    setError(null);
  }); }, [enqueue]);

  // Point i to p: the legs before and after it are routed again, through p.
  const move = useCallback((i: number, p: LngLat) => enqueue(async () => {
    const s = state.current;
    setError(null);
    if (i < 0 || i >= s.points.length) return;
    if (s.points.length === 1) { s.points[0] = p; return; }
    const before = i > 0 ? await routeLeg(s.points[i - 1], p) : null;
    if (i > 0 && !before) { setError('No route to that point on trails or roads.'); return; }
    const at = before ? before.coords.at(-1)! : p;
    const after = i < s.points.length - 1 ? await routeLeg(at, s.points[i + 1]) : null;
    if (i < s.points.length - 1 && !after) { setError('No route from that point on trails or roads.'); return; }
    if (before) s.legs[i - 1] = before;
    if (after) s.legs[i] = after;
    s.points[i] = before ? at : after!.coords[0];
  }), [enqueue, routeLeg]);

  const set = useCallback(async (ps: LngLat[]) => {
    await enqueue(async () => { state.current = { points: [], legs: [] }; });
    for (const p of ps) await add(p);
  }, [enqueue, add]);

  useEffect(() => {
    if (!map || !active) return;
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: MapMouseEvent) => {
      // A click on a point is the start of a drag, not a new point.
      if (map.getLayer(`${id}-hit`) && map.queryRenderedFeatures(e.point, { layers: [`${id}-hit`] }).length) return;
      add([e.lngLat.lng, e.lngLat.lat]);
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); map.getCanvas().style.cursor = ''; };
  }, [map, active, add, id]);

  // Dragging a point, with a mouse or a finger: it follows the pointer, and
  // on release the legs either side are routed through where it was dropped.
  useEffect(() => {
    if (!map) return;
    const hit = `${id}-hit`;
    let dragging: number | null = null;
    const follow = (p: LngLat) => {
      const ps = [...state.current.points];
      ps[dragging!] = p;
      map.getSource<GeoJSONSource>(`${id}-points`)?.setData(pointsData(ps));
    };
    const start = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const i = e.features?.[0]?.properties?.i;
      if (typeof i !== 'number') return;
      if ('points' in e && e.points.length !== 1) return;
      e.preventDefault();
      dragging = i;
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    };
    const moveTo = (e: MapMouseEvent | MapLayerTouchEvent) => { if (dragging !== null) follow([e.lngLat.lng, e.lngLat.lat]); };
    const end = (e: MapMouseEvent | MapLayerTouchEvent) => {
      if (dragging === null) return;
      const i = dragging;
      dragging = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = active ? 'crosshair' : '';
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      // A loop or an out-and-back starts and ends at one place: dragging
      // either end moves both, as one trailhead.
      const ps = state.current.points, last = ps.length - 1;
      if (last > 1 && (i === 0 || i === last) && haversine(ps[0], ps[last]) <= SAME_END_M) {
        move(0, p).then(() => move(last, state.current.points[0]));
      } else move(i, p);
    };
    const over = () => { if (dragging === null) map.getCanvas().style.cursor = 'grab'; };
    const out = () => { if (dragging === null) map.getCanvas().style.cursor = active ? 'crosshair' : ''; };
    map.on('mousedown', hit, start); map.on('touchstart', hit, start);
    map.on('mousemove', moveTo); map.on('touchmove', moveTo);
    map.on('mouseup', end); map.on('touchend', end);
    map.on('mouseenter', hit, over); map.on('mouseleave', hit, out);
    return () => {
      map.off('mousedown', hit, start); map.off('touchstart', hit, start);
      map.off('mousemove', moveTo); map.off('touchmove', moveTo);
      map.off('mouseup', end); map.off('touchend', end);
      map.off('mouseenter', hit, over); map.off('mouseleave', hit, out);
      if (dragging !== null) map.dragPan.enable();
    };
  }, [map, id, active, move]); // eslint-disable-line react-hooks/exhaustive-deps

  return { points, coords, metres, busy, error, undo, clear, set, move };
}
