// Route planning on the map: in route mode, click points to get a route
// through them along trails and roads (each click is routed from the one
// before, and can be undone), its distance and climb, and an elevation chart
// you can hover to see each point on the route. It all runs in the browser,
// on the basemap's own tiles (see app/routing/ and useWaypoints).
import { useEffect, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { LngLat } from '~/routing/graph';
import { profile, type Profile } from '~/routing/elevation';
import { useWaypoints } from '~/components/useWaypoints';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const COLOR = '#c026d3';

interface Result { metres: number; profile: Profile }

export default function RoutePlanner(props: { map: MaplibreMap | null; tiles: string }) {
  const { map, tiles } = props;
  const [active, setActive] = useState(false);
  const route = useWaypoints(map, tiles, { id: 'route', color: COLOR, active });
  const [result, setResult] = useState<Result | null>(null);
  const hoverAdded = useRef(false);

  // The elevation profile of the route so far, redone as it changes.
  useEffect(() => {
    if (route.coords.length < 2) { setResult(null); return; }
    let stale = false;
    const metres = route.metres;
    profile(route.coords).then((p) => { if (!stale) setResult({ metres, profile: p }); }).catch(() => {});
    return () => { stale = true; };
  }, [route.coords, route.metres]);

  // Mark the point on the route that the elevation chart is hovered at.
  const showHover = (p: LngLat | null) => {
    if (!map) return;
    if (!hoverAdded.current) {
      hoverAdded.current = true;
      map.addSource('route-hover', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-hover', type: 'circle', source: 'route-hover', paint: { 'circle-radius': 6, 'circle-color': '#0b0b0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
    }
    map.getSource<GeoJSONSource>('route-hover')?.setData(p
      ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }
      : EMPTY);
  };

  // Test hook, in development only: route through points.
  useEffect(() => {
    if (!map || process.env.NODE_ENV === 'production') return;
    (window as Window & { __routePlanner?: unknown }).__routePlanner = {
      map, route: (...ps: LngLat[]) => { setActive(true); return route.set(ps); },
    };
  }, [map, route.set]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!map) return null;

  if (!active) {
    return <button
      className='tap absolute left-3 top-3 bg-white rounded shadow px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50'
      style={{ zIndex: 2 }}
      onClick={() => { route.clear(); setActive(true); }}
      title='Plan a route: click points on the map, in order'
    >Route</button>;
  }

  const n = route.points.length;
  const status = route.error ?? (route.busy ? 'Finding a route…'
    : n === 0 ? 'Click the map to set a start.'
    : n === 1 ? 'Click the next point: each is routed along trails from the one before.'
    : 'Click to add a point, or undo the last one.');

  return <div
    className='absolute left-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm'
    style={{ zIndex: 2, width: 'min(600px, calc(100% - 24px))' }}
  >
    <div className='flex items-start justify-between gap-2'>
      <div className='text-gray-600'>{status}</div>
      <div className='flex items-center gap-1 shrink-0'>
        <button className='tap px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40'
          disabled={!n} onClick={route.undo} title='Remove the last point'>Undo</button>
        <button className='tap px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40'
          disabled={!n} onClick={route.clear} title='Start over'>Clear</button>
        <button className='tap text-gray-500 hover:text-gray-900 leading-none text-lg ml-1' aria-label='Close route' title='Close route'
          onClick={() => { route.clear(); showHover(null); setActive(false); }}>×</button>
      </div>
    </div>
    {result && n > 1 && <RouteSummary r={result} onHover={showHover} />}
  </div>;
}

function RouteSummary({ r, onHover }: { r: Result; onHover: (p: LngLat | null) => void }) {
  const pts = r.profile.points;
  const elevs = pts.map(([, e]) => e);
  const hi = Math.max(...elevs), lo = Math.min(...elevs);
  return <div className='mt-1'>
    <div className='font-semibold text-base'>
      {(r.metres / 1000).toFixed(1)} km · ↑ {Math.round(r.profile.gain)} m · ↓ {Math.round(r.profile.loss)} m · high point {Math.round(hi)} m
    </div>
    <ElevationChart points={pts} lo={lo} hi={hi} onHover={(i) => onHover(i === null ? null : r.profile.coords[i])} />
  </div>;
}

// Marks are places along the route (e.g. campsites), at metres from its start.
export interface Mark { at: number; label: string }

export function ElevationChart({ points, lo, hi, onHover, marks = [] }: { points: [number, number][]; lo: number; hi: number; onHover: (i: number | null) => void; marks?: Mark[] }) {
  // Drawn at the SVG's own width in px (measured), so its 10 px text is 10 px
  // on a phone too; a fixed box scaled to the panel shrank it to ~5 px.
  const ref = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(576);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 150, L = 44, B = 20, T = 8;
  const [hover, setHover] = useState<number | null>(null);
  const total = points[points.length - 1][0];
  const yMin = Math.floor((lo - 50) / 100) * 100, yMax = Math.ceil((hi + 50) / 100) * 100;
  const x = (d: number) => L + (d / total) * (W - L - 4);
  const y = (e: number) => T + (1 - (e - yMin) / (yMax - yMin)) * (H - T - B);
  const line = points.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  // About one km label per 60 px.
  const kmStep = [1, 2, 5, 10, 20, 50].find((s) => (total / 1000 / s) * 60 <= W - L) ?? 100;
  const xTicks = Array.from({ length: Math.floor(total / 1000 / kmStep) + 1 }, (_, i) => i * kmStep);
  const yStep = (yMax - yMin) > 1500 ? 500 : (yMax - yMin) > 600 ? 200 : 100;
  const yTicks: number[] = [];
  for (let e = Math.ceil(yMin / yStep) * yStep; e <= yMax; e += yStep) yTicks.push(e);

  // The sample nearest the pointer. Samples are evenly spaced (10 m), so the
  // index is about proportional to the distance along the route.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const d = ((px - L) / (W - L - 4)) * total;
    if (d < 0 || d > total) { onLeave(); return; }
    let i = Math.max(0, Math.min(points.length - 1, Math.round((d / total) * (points.length - 1))));
    while (i > 0 && points[i][0] > d && points[i - 1][0] >= d) i--;
    while (i < points.length - 1 && Math.abs(points[i + 1][0] - d) < Math.abs(points[i][0] - d)) i++;
    setHover(i);
    onHover(i);
  };
  const onLeave = () => { setHover(null); onHover(null); };
  const hp = hover === null ? null : points[hover];
  const label = hp && `${(hp[0] / 1000).toFixed(1)} km of ${(total / 1000).toFixed(1)} km · ${Math.round(hp[1]).toLocaleString()} m`;
  const labelW = 170;
  const labelX = hp && Math.min(Math.max(x(hp[0]) - labelW / 2, L), W - 4 - labelW);
  // Label a mark only if it isn't crowding the last labelled one.
  let lastX = -Infinity;
  const labelled = marks.map((m) => {
    const ok = x(m.at) - lastX >= 70;
    if (ok) lastX = x(m.at);
    return ok;
  });

  // pan-y: a vertical swipe on the chart scrolls the panel (the browser then
  // cancels the pointer); a horizontal drag scrubs along the route.
  return <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width='100%' className='mt-1 block' role='img' aria-label='Elevation profile'
    style={{ touchAction: 'pan-y', cursor: 'crosshair' }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={onLeave} onPointerCancel={onLeave}>
    {yTicks.map((e) => <g key={e}>
      <line x1={L} x2={W - 4} y1={y(e)} y2={y(e)} stroke='#e1e0d9' />
      <text x={L - 6} y={y(e) + 4} textAnchor='end' fontSize='10' fill='#898781'>{e}</text>
    </g>)}
    {xTicks.map((k) => <text key={k} x={x(k * 1000)} y={H - 5} textAnchor='middle' fontSize='10' fill='#898781'>{k} km</text>)}
    <polygon points={`${x(0)},${y(yMin)} ${line} ${x(total)},${y(yMin)}`} fill='#2a78d6' fillOpacity='0.12' />
    <polyline points={line} fill='none' stroke='#2a78d6' strokeWidth='2' strokeLinejoin='round' />
    {marks.map((m, i) => {
      return <g key={i} pointerEvents='none'>
        <line x1={x(m.at)} x2={x(m.at)} y1={T} y2={H - B} stroke='#16a34a' strokeDasharray='2 3' />
        {labelled[i] && <text x={Math.min(x(m.at) + 3, W - 70)} y={H - B - 4} fontSize='10' fill='#15803d'>⛺ {m.label.length > 14 ? m.label.slice(0, 13) + '…' : m.label}</text>}
      </g>;
    })}
    {hp && <g pointerEvents='none'>
      <line x1={x(hp[0])} x2={x(hp[0])} y1={T} y2={H - B} stroke='#52514e' strokeWidth='1' strokeDasharray='3 3' />
      <circle cx={x(hp[0])} cy={y(hp[1])} r='4.5' fill='#0b0b0b' stroke='#ffffff' strokeWidth='2' />
      <rect x={labelX!} y={T} width={labelW} height='18' rx='3' fill='#ffffff' stroke='#e1e0d9' />
      <text x={labelX! + labelW / 2} y={T + 13} textAnchor='middle' fontSize='11' fill='#0b0b0b'>{label}</text>
    </g>}
  </svg>;
}
