// A small, still map (no panning, zooming or controls but the credits) of a
// box, for the homepage's featured park and hike: optionally a park tinted
// and outlined, and a route with numbered stops drawn over it. `muted` greys
// the basemap down (a filter on the map's canvas only), so a route drawn over
// it, as SVG at its projected points, keeps its colour. It starts only once
// it's scrolled into view, so the homepage doesn't load the map until it's
// seen. The tiles are set up as Map does (its zstd PMTiles, contours and
// Newfoundland DEM protocols).
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { registerContours, zstdProtocol } from './Map';
import { demTransformRequest, nlDemProtocol } from './nlDem';

let ready = false;
function setup() {
  if (ready) return;
  ready = true;
  maplibregl.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
  registerContours();
  maplibregl.addProtocol('nldem', nlDemProtocol);
  maplibregl.addProtocol('pmtiles', zstdProtocol().tile);
}

export interface Overlay {
  line: [number, number][];
  stops: { n: number; at: [number, number] }[];
}

type Projected = { line: string; start: [number, number]; stops: { n: number; x: number; y: number }[] };

export default function MiniMap({ style, bounds, parkId, overlay, muted, padding = 12, label, className }: {
  style: string;
  bounds: [number, number, number, number];
  parkId?: string;
  overlay?: Overlay;
  muted?: boolean;
  padding?: number;
  label: string;
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [proj, setProj] = useState<Projected | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen || !box.current) return;
    setup();
    const m = new maplibregl.Map({
      container: box.current,
      style,
      bounds,
      fitBoundsOptions: { padding },
      interactive: false,
      transformRequest: demTransformRequest,
      attributionControl: { compact: true },
    });
    if (muted) m.getCanvas().style.filter = 'saturate(0.25) brightness(1.08) contrast(0.92)';
    const project = () => {
      if (!overlay) return;
      const p = (c: [number, number]) => { const q = m.project(c); return [q.x, q.y] as [number, number]; };
      setProj({
        line: overlay.line.map((c) => p(c).map((v) => v.toFixed(1)).join(',')).join(' '),
        start: p(overlay.line[0]),
        stops: overlay.stops.map((s) => { const [x, y] = p(s.at); return { n: s.n, x, y }; }),
      });
    };
    m.once('load', () => {
      // The credits start folded, behind their (i), as on the map page.
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      if (parkId) {
        const id = ['==', ['to-string', ['get', 'osm_id']], parkId] as maplibregl.FilterSpecification;
        const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        m.addLayer({ id: 'feat-park-fill', type: 'fill', source: 'tiles1', 'source-layer': 'park', filter: id, paint: { 'fill-color': '#15803d', 'fill-opacity': 0.14 } }, before);
        m.addLayer({ id: 'feat-park-line', type: 'line', source: 'tiles1', 'source-layer': 'park_outline', filter: id, paint: { 'line-color': '#14532d', 'line-width': 2.5, 'line-opacity': 0.85 } }, before);
      }
      project();
    });
    m.on('resize', project);
    return () => m.remove();
  }, [seen, style, bounds, parkId, overlay, muted, padding]);

  return <div role='img' aria-label={label} className={`relative overflow-hidden bg-[#eef2ea] ${className}`}>
    <div ref={box} className='absolute inset-0' />
    {proj && <svg className='pointer-events-none absolute inset-0 h-full w-full' aria-hidden='true'>
      <polyline points={proj.line} fill='none' stroke='#ffffff' strokeWidth='6' strokeLinejoin='round' strokeLinecap='round' />
      <polyline points={proj.line} fill='none' stroke='#c026d3' strokeWidth='3' strokeLinejoin='round' strokeLinecap='round' />
      <circle cx={proj.start[0]} cy={proj.start[1]} r='6' fill='#15803d' stroke='#ffffff' strokeWidth='2' />
      {proj.stops.map((s) => <g key={s.n}>
        <circle cx={s.x} cy={s.y} r='8' fill='#a21caf' stroke='#ffffff' strokeWidth='1.5' />
        <text x={s.x} y={s.y + 3.5} textAnchor='middle' fontSize='10' fontWeight='700' fill='#ffffff'>{s.n}</text>
      </g>)}
    </svg>}
  </div>;
}
