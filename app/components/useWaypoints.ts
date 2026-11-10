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

// Each leg is routed between two of the points as placed (clicked or
// dropped), snapping both to the nearest trail or road. The points shown are
// where they snapped, except, with `exactEnds`, the start and end: those stay
// exactly where they were put (a trailhead in a parking lot, off the paths),
// joined to the route by a straight line. Routes' named regressions check a
// trace's start and end, so there they matter most.
interface Route { placed: LngLat[]; legs: Leg[] }
const FAR_M = 1; // an end further than this from where it snapped gets its own connector
// Tiles kept for routing (about 6 KB each): a leg near earlier ones needs none fetched.
const TILE_CACHE = 2000;
// While planning, the tiles in view (and VIEW_MARGIN around) are fetched
// ahead of the clicks, from VIEW_MIN_ZOOM in and up to VIEW_MAX_TILES
// (~3 MB): at z12 on a 1280x900 map, ~430 tiles.
const VIEW_MIN_ZOOM = 12, VIEW_MARGIN = 2, VIEW_MAX_TILES = 600;

function shape(r: Route, exactEnds: boolean): { points: LngLat[]; coords: LngLat[]; metres: number } {
  const n = r.placed.length;
  if (n < 2 || r.legs.length < n - 1) return { points: [...r.placed], coords: [], metres: 0 };
  const points = r.placed.map((p, i) => {
    if (exactEnds && (i === 0 || i === n - 1)) return p;
    return i === 0 ? r.legs[0].coords[0] : r.legs[i - 1].coords.at(-1)!;
  });
  let coords = r.legs.flatMap((l, i) => (i ? l.coords.slice(1) : l.coords));
  let metres = r.legs.reduce((s, l) => s + l.metres, 0);
  if (exactEnds) {
    const [a, b] = [r.placed[0], r.placed[n - 1]];
    if (haversine(a, coords[0]) > FAR_M) { metres += haversine(a, coords[0]); coords = [a, ...coords]; }
    if (haversine(coords.at(-1)!, b) > FAR_M) { metres += haversine(coords.at(-1)!, b); coords = [...coords, b]; }
  }
  return { points, coords, metres };
}

// `id` prefixes the map sources and layers it adds; `active` is whether
// clicks on the map add points; `exactEnds` keeps the start and end where
// they were put rather than where they snap to the paths.
export function useWaypoints(map: MaplibreMap | null, tiles: string, opts: { id: string; color: string; active: boolean; exactEnds?: boolean }): Waypoints {
  const { id, color, active, exactEnds = false } = opts;
  const [route, setRoute] = useState<Route>({ placed: [], legs: [] });
  const [busy, setBusy] = useState(false);
  // Clicks not yet routed, drawn at once (hollow, joined to the route by a
  // dashed line) so a click shows it was taken while its leg is found (#91).
  const [pending, setPending] = useState<LngLat[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The work queue: legs are routed one at a time, in click order, so an
  // undo or a fast second click waits for the leg before it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const state = useRef<Route>({ placed: [], legs: [] });
  const source = useRef<Archive | null>(null);
  const sourceFor = useRef<string | null>(null);
  // Tiles fetched (or being fetched) for routing, by "x/y", oldest first.
  // Fetching from R2 is most of a leg's time (a round trip of 0.5-1.5 s,
  // whatever the size), and legs overlap: each reads a box of at least 5x5
  // tiles around its ends (tilesAround).
  const cache = useRef(new Map<string, Promise<{ data: ArrayBuffer } | undefined>>());

  const ensureSource = useCallback(() => {
    if (source.current && sourceFor.current === tiles) return;
    const decompress = withZstd(new pmtiles.PMTiles("").decompress);
    source.current = new pmtiles.PMTiles(new CoalescingSource(new pmtiles.FetchSource(tiles)), undefined, decompress);
    sourceFor.current = tiles;
    cache.current.clear();
  }, [tiles]);

  // The routing tile source: the archive's tiles, through the cache.
  const cached = useMemo(() => ({
    getZxy(z: number, x: number, y: number) {
      ensureSource();
      const key = `${x}/${y}`;
      let t = cache.current.get(key);
      if (!t) {
        t = source.current!.getZxy(z, x, y);
        // A failed fetch isn't kept: the next leg tries again.
        t.catch(() => cache.current.delete(key));
        cache.current.set(key, t);
        if (cache.current.size > TILE_CACHE) cache.current.delete(cache.current.keys().next().value!);
      }
      return t;
    },
  }), [ensureSource]);

  // Fetch the tiles a leg from p would read, before it's asked for: while
  // the next point is being picked.
  const prefetch = useCallback((p: LngLat) => {
    for (const [x, y] of tilesAround(p, p)) cached.getZxy(Z, x, y).catch(() => {});
  }, [cached]);

  // And while planning, those in view: a click anywhere on screen then routes
  // from memory. A round trip to R2 is 0.5-4 s however small; a view's tiles,
  // asked for at once, come in a few merged ranges (CoalescingSource).
  useEffect(() => {
    if (!map || !active) return;
    const fetchView = () => {
      if (map.getZoom() < VIEW_MIN_ZOOM) return;
      const b = map.getBounds();
      const [x0, y0] = lngLatToTile(b.getWest(), b.getNorth(), Z).map((v) => Math.floor(v) - VIEW_MARGIN);
      const [x1, y1] = lngLatToTile(b.getEast(), b.getSouth(), Z).map((v) => Math.floor(v) + VIEW_MARGIN);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > VIEW_MAX_TILES) return;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cached.getZxy(Z, x, y).catch(() => {});
    };
    fetchView();
    map.on('moveend', fetchView);
    return () => { map.off('moveend', fetchView); };
  }, [map, active, cached]);

  const layers = useRef(false);
  const addLayers = useCallback(() => {
    if (!map || layers.current) return;
    layers.current = true;
    map.addSource(`${id}-line`, { type: 'geojson', data: EMPTY });
    map.addSource(`${id}-points`, { type: 'geojson', data: EMPTY });
    map.addSource(`${id}-pending`, { type: 'geojson', data: EMPTY });
    const round: LineLayerSpecification['layout'] = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: `${id}-line-casing`, type: 'line', source: `${id}-line`, layout: round, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: `${id}-line`, type: 'line', source: `${id}-line`, layout: round, paint: { 'line-color': color, 'line-width': 4 } });
    map.addLayer({ id: `${id}-pending-line`, type: 'line', source: `${id}-pending`, filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
    map.addLayer({ id: `${id}-pending-points`, type: 'circle', source: `${id}-pending`, filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': color, 'circle-stroke-width': 2.5 } });
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
  const { points, coords, metres } = useMemo(() => shape(route, exactEnds), [route, exactEnds]);

  // Draw what's in state.
  useEffect(() => {
    if (!map || !layers.current) return;
    map.getSource<GeoJSONSource>(`${id}-line`)?.setData(coords.length
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY);
    map.getSource<GeoJSONSource>(`${id}-points`)?.setData(pointsData(points));
  }, [map, id, points, coords]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clicks still being routed, from the route's last point.
  useEffect(() => {
    if (!map || !layers.current) return;
    const from = points.length ? [points[points.length - 1]] : [];
    const chain = [...from, ...pending];
    map.getSource<GeoJSONSource>(`${id}-pending`)?.setData(pending.length ? {
      type: 'FeatureCollection',
      features: [
        ...(chain.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: chain } }] : []),
        ...pending.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })),
      ],
    } : EMPTY);
    // A busy cursor while routing; put back only if it's still ours.
    const canvas = map.getCanvas();
    if (pending.length || busy) canvas.style.cursor = 'progress';
    else if (canvas.style.cursor === 'progress') canvas.style.cursor = active ? 'crosshair' : '';
  }, [map, id, points, pending, busy, active]);

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

  const commit = () => { setRoute({ placed: [...state.current.placed], legs: [...state.current.legs] }); };

  // A leg from the end of the route so far (or the previous point) to p.
  const routeLeg = useCallback(async (from: LngLat, to: LngLat): Promise<Leg | null> => {
    const g = await buildGraph(cached, tilesAround(from, to));
    const found = shortestPath(g, ...snapPair(g, from, to));
    if (!found) return null;
    return { coords: found.path.map((i) => worldToLngLat(g, i)), metres: found.metres };
  }, [cached]);

  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(async () => {
      setBusy(true);
      try { await job(); } catch (e) { setError((e as Error).message ?? String(e)); }
      finally { setBusy(false); commit(); }
    });
    return queue.current;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback((p: LngLat) => {
    setPending((ps) => [...ps, p]);
    return enqueue(async () => {
      const s = state.current;
      setError(null);
      if (!s.placed.length) {
        s.placed.push(p);
        prefetch(p);
        return;
      }
      const leg = await routeLeg(s.placed[s.placed.length - 1], p);
      if (!leg) { setError('No route to that point on trails or roads.'); return; }
      s.placed.push(p);
      s.legs.push(leg);
      prefetch(p);
    // Once committed: the routed point replaces the pending one.
    }).finally(() => setPending((ps) => ps.slice(1)));
  }, [enqueue, prefetch, routeLeg]);

  const undo = useCallback(() => { enqueue(async () => {
    const s = state.current;
    setError(null);
    if (s.placed.length > 1) s.legs.pop();
    s.placed.pop();
  }); }, [enqueue]);

  const clear = useCallback(() => { enqueue(async () => {
    state.current = { placed: [], legs: [] };
    setError(null);
  }); }, [enqueue]);

  // Point i to p: the legs before and after it are routed again, through p.
  const move = useCallback((i: number, p: LngLat) => enqueue(async () => {
    const s = state.current;
    setError(null);
    if (i < 0 || i >= s.placed.length) return;
    const before = i > 0 ? await routeLeg(s.placed[i - 1], p) : null;
    if (i > 0 && !before) { setError('No route to that point on trails or roads.'); return; }
    const after = i < s.placed.length - 1 ? await routeLeg(p, s.placed[i + 1]) : null;
    if (i < s.placed.length - 1 && !after) { setError('No route from that point on trails or roads.'); return; }
    if (before) s.legs[i - 1] = before;
    if (after) s.legs[i] = after;
    s.placed[i] = p;
    if (i === s.placed.length - 1) prefetch(p);
  }), [enqueue, prefetch, routeLeg]);

  const set = useCallback(async (ps: LngLat[]) => {
    await enqueue(async () => { state.current = { placed: [], legs: [] }; });
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
      const ps = [...shape(state.current, exactEnds).points];
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
      const ps = state.current.placed, last = ps.length - 1;
      if (last > 1 && (i === 0 || i === last) && haversine(ps[0], ps[last]) <= SAME_END_M) {
        move(0, p).then(() => move(last, p));
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
  }, [map, id, active, move, exactEnds]); // eslint-disable-line react-hooks/exhaustive-deps

  return { points, coords, metres, busy, error, undo, clear, set, move };
}
