// A route drawn by clicking points on the map: each click is routed along
// trails and roads from the one before (see app/routing/), and the last point
// can be undone. Used by the map's route planner and the named-regressions
// page (routes/dev.regressions.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, LineLayerSpecification, MapMouseEvent } from 'maplibre-gl';
import { withZstd, type Decompress } from '~/zstd';
import { Z, buildGraph, lngLatToTile, shortestPath, snapPair, tilesAround, worldToLngLat, type LngLat } from '~/routing/graph';
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
    map.addLayer({ id: `${id}-points`, type: 'circle', source: `${id}-points`, paint: { 'circle-radius': ['case', ['get', 'end'], 7, 5], 'circle-color': color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
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
    map.getSource<GeoJSONSource>(`${id}-points`)?.setData({
      type: 'FeatureCollection',
      features: points.map((p, i): GeoJSON.Feature => ({ type: 'Feature', properties: { end: i === 0 || i === points.length - 1 }, geometry: { type: 'Point', coordinates: p } })),
    });
  }, [map, id, points, legs]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const set = useCallback(async (ps: LngLat[]) => {
    await enqueue(async () => { state.current = { points: [], legs: [] }; });
    for (const p of ps) await add(p);
  }, [enqueue, add]);

  useEffect(() => {
    if (!map || !active) return;
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: MapMouseEvent) => { add([e.lngLat.lng, e.lngLat.lat]); };
    map.on('click', onClick);
    return () => { map.off('click', onClick); map.getCanvas().style.cursor = ''; };
  }, [map, active, add]);

  return { points, coords, metres, busy, error, undo, clear, set };
}
