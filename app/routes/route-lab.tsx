// Prototype: route between two clicked points on the basemap's own tiles,
// with distance and an elevation profile, all in the browser. Not linked
// from anywhere yet.
import { useEffect, useRef, useState } from 'react';
import type { MetaFunction } from "@remix-run/cloudflare";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Map from '~/components/Map';
import { styleUrl, tilesUrl } from '~/build';
import { withZstd, type Decompress } from '~/zstd';
import { buildGraph, nearestNode, shortestPath, tilesAround, worldToLngLat, type LngLat } from '~/route-lab/graph';
import { profile, type Profile } from '~/route-lab/elevation';

export const handle: ExternalScriptsHandle = {
  scripts: [{ src: "https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js", crossOrigin: 'anonymous', async: false, defer: false, preload: true }],
};

export const meta: MetaFunction = () => [{ title: "Hiker Atlas - Route lab" }];

declare const pmtiles: {
  PMTiles: new (url: string, cache?: unknown, decompress?: Decompress) => {
    decompress: Decompress;
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
  };
};

const EXAMPLE: [LngLat, LngLat] = [[-123.120441, 49.957632], [-123.0181555, 49.9534762]]; // Rubble Creek trailhead -> Panorama Ridge overlook
const EMPTY = { type: 'FeatureCollection', features: [] };

interface Result { metres: number; profile: Profile; tiles: number; nodes: number; ms: number }

export default function RouteLab() {
  const [map, setMap] = useState<any>(null);
  const [status, setStatus] = useState('Click the map to set a start, then an end.');
  const [result, setResult] = useState<Result | null>(null);
  const points = useRef<LngLat[]>([]);
  const source = useRef<any>(null);

  useEffect(() => {
    if (!map) return;
    const setup = () => {
      map.addSource('lab-route', { type: 'geojson', data: EMPTY });
      map.addSource('lab-points', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'lab-route-casing', type: 'line', source: 'lab-route', paint: { 'line-color': '#ffffff', 'line-width': 7 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
      map.addLayer({ id: 'lab-route', type: 'line', source: 'lab-route', paint: { 'line-color': '#c026d3', 'line-width': 4 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
      map.addLayer({ id: 'lab-points', type: 'circle', source: 'lab-points', paint: { 'circle-radius': 7, 'circle-color': '#c026d3', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    };
    if (map.isStyleLoaded()) setup(); else map.once('load', setup);
    const onClick = (e: any) => {
      if (points.current.length >= 2) points.current = [];
      points.current.push([e.lngLat.lng, e.lngLat.lat]);
      showPoints();
      if (points.current.length === 2) route(points.current[0], points.current[1]);
      else { setResult(null); setStatus('Now click an end.'); map.getSource('lab-route')?.setData(EMPTY); }
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map]);

  const showPoints = () => map.getSource('lab-points')?.setData({
    type: 'FeatureCollection',
    features: points.current.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })),
  });

  const route = async (a: LngLat, b: LngLat) => {
    const t0 = performance.now();
    try {
      if (!source.current) {
        const decompress = withZstd(new pmtiles.PMTiles("").decompress);
        source.current = new pmtiles.PMTiles(tilesUrl('north-america'), undefined, decompress);
      }
      const tiles = tilesAround(a, b);
      setStatus(`Loading ${tiles.length} tiles…`);
      const g = await buildGraph(source.current, tiles);
      const found = shortestPath(g, nearestNode(g, a), nearestNode(g, b));
      if (!found) { setStatus('No route between those points on trails or roads.'); return; }
      const coords = found.path.map((i) => worldToLngLat(g, i));
      map.getSource('lab-route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
      setStatus('Measuring elevation…');
      const prof = await profile(coords);
      setResult({ metres: found.metres, profile: prof, tiles: tiles.length, nodes: g.xs.length, ms: performance.now() - t0 });
      setStatus('Click to start a new route.');
    } catch (e: any) {
      setStatus(`Error: ${e.message ?? e}`);
    }
  };

  const example = () => {
    points.current = [...EXAMPLE];
    showPoints();
    map.fitBounds([[-123.13, 49.94], [-123.0, 49.97]], { padding: 40, duration: 0 });
    route(EXAMPLE[0], EXAMPLE[1]);
  };

  return <>
    <div className='h-[60px] p-2 flex items-center gap-4'>
      <h1 className='text-2xl'>Hiker Atlas <span className='text-sm text-gray-500'>route lab (prototype)</span></h1>
      <button className='text-sm underline text-gray-600' onClick={example} disabled={!map}>Example: Rubble Creek → Panorama Ridge</button>
    </div>
    <div className='map-wrap relative' style={{ height: 'calc(100vh - 60px)' }}>
      <Map style={styleUrl(null)} lng={-123.07} lat={49.955} zoom={12} onInitialized={((m: any) => setMap(m)) as any} />
      <div className='absolute left-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm' style={{ width: 600, zIndex: 2 }}>
        <div className='text-gray-600'>{status}</div>
        {result && <RouteSummary r={result} />}
      </div>
    </div>
  </>;
}

function RouteSummary({ r }: { r: Result }) {
  const pts = r.profile.points;
  const elevs = pts.map(([, e]) => e);
  const hi = Math.max(...elevs), lo = Math.min(...elevs);
  return <div className='mt-1'>
    <div className='font-semibold text-base'>
      {(r.metres / 1000).toFixed(1)} km · ↑ {Math.round(r.profile.gain)} m · ↓ {Math.round(r.profile.loss)} m · high point {Math.round(hi)} m
    </div>
    <ElevationChart points={pts} lo={lo} hi={hi} />
    <div className='text-xs text-gray-500'>{r.tiles} tiles, {r.nodes.toLocaleString()} graph nodes, {(r.ms / 1000).toFixed(1)} s</div>
  </div>;
}

function ElevationChart({ points, lo, hi }: { points: [number, number][]; lo: number; hi: number }) {
  const W = 576, H = 150, L = 44, B = 20, T = 8;
  const total = points[points.length - 1][0];
  const yMin = Math.floor((lo - 50) / 100) * 100, yMax = Math.ceil((hi + 50) / 100) * 100;
  const x = (d: number) => L + (d / total) * (W - L - 4);
  const y = (e: number) => T + (1 - (e - yMin) / (yMax - yMin)) * (H - T - B);
  const line = points.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  const kmStep = total > 20000 ? 5 : total > 8000 ? 2 : 1;
  const xTicks = Array.from({ length: Math.floor(total / 1000 / kmStep) + 1 }, (_, i) => i * kmStep);
  const yStep = (yMax - yMin) > 1500 ? 500 : (yMax - yMin) > 600 ? 200 : 100;
  const yTicks: number[] = [];
  for (let e = Math.ceil(yMin / yStep) * yStep; e <= yMax; e += yStep) yTicks.push(e);
  return <svg width={W} height={H} className='mt-1' role='img' aria-label='Elevation profile'>
    {yTicks.map((e) => <g key={e}>
      <line x1={L} x2={W - 4} y1={y(e)} y2={y(e)} stroke='#e1e0d9' />
      <text x={L - 6} y={y(e) + 4} textAnchor='end' fontSize='10' fill='#898781'>{e}</text>
    </g>)}
    {xTicks.map((k) => <text key={k} x={x(k * 1000)} y={H - 5} textAnchor='middle' fontSize='10' fill='#898781'>{k} km</text>)}
    <polygon points={`${x(0)},${y(yMin)} ${line} ${x(total)},${y(yMin)}`} fill='#2a78d6' fillOpacity='0.12' />
    <polyline points={line} fill='none' stroke='#2a78d6' strokeWidth='2' strokeLinejoin='round' />
  </svg>;
}
