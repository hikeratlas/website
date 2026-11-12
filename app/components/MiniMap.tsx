// A small, still map (no panning, zooming or controls but the credits) of a
// box, for the homepage's featured park and hike: optionally a park tinted
// and outlined, and a route with numbered stops drawn over it. `muted` greys
// the basemap down (a filter on the map's canvas only), so a route drawn over
// it, as SVG at its projected points, keeps its colour. It starts only once
// it's scrolled into view, so the homepage doesn't load the map until it's
// seen. The tiles are set up as Map does (its zstd PMTiles, contours and
// Newfoundland DEM protocols).
import { useEffect, useId, useRef, useState } from 'react';
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
// The park, over a muted map: its area, as one SVG path of its tiles' pieces,
// and where its name goes (the middle of its part in view).
type ParkShape = { area: string; label: [number, number] | null };

type Ring = [number, number][];
const pathOf = (rings: Ring[], close: boolean) => rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}`).join('');

export default function MiniMap({ style, bounds, parkIds, parkName, overlay, muted, padding = 12, label, className }: {
  style: string;
  bounds: [number, number, number, number];
  // The park's OSM ids (any of them, a park mapped twice has several).
  parkIds?: string[];
  // Shown as the map's only label, over a muted map with a park.
  parkName?: string;
  overlay?: Overlay;
  muted?: boolean;
  padding?: number;
  label: string;
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [proj, setProj] = useState<Projected | null>(null);
  const [park, setPark] = useState<ParkShape | null>(null);
  const edge = `edge${useId().replace(/:/g, '')}`;

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
    // A new box (another park): none of the last one's drawing.
    setProj(null);
    setPark(null);
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
    // Over a muted map, the park is drawn as SVG (the canvas's filter would
    // mute it too): its polygon pieces from the tiles once they're in,
    // projected, as one path. Filled nonzero, overlapping pieces (tiles
    // overlap at their edges) are one area; its outline is traced from that
    // area (an SVG filter), so tile seams never show. The park_outline layer
    // would avoid seams too, but it starts at z9, and a big park's map is
    // further out (Banff's, z7).
    const drawPark = () => {
      if (!parkIds || !muted) return;
      const id = ['in', ['to-string', ['get', 'osm_id']], ['literal', parkIds]] as maplibregl.FilterSpecification;
      const p = (c: number[]) => { const q = m.project([c[0], c[1]]); return [q.x, q.y] as [number, number]; };
      const rings: Ring[] = [];
      for (const f of m.querySourceFeatures('tiles1', { sourceLayer: 'park', filter: id })) {
        const g = f.geometry;
        const all = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        for (const poly of all) for (const ring of poly) rings.push(ring.map(p));
      }
      // Its name at the middle of its part in view.
      const { width: w, height: h } = m.getContainer().getBoundingClientRect();
      const inView = rings.flat().filter(([x, y]) => x >= 0 && x <= w && y >= 0 && y <= h);
      const label: [number, number] | null = inView.length
        ? [(Math.min(...inView.map((q) => q[0])) + Math.max(...inView.map((q) => q[0]))) / 2, (Math.min(...inView.map((q) => q[1])) + Math.max(...inView.map((q) => q[1]))) / 2]
        : null;
      setPark({ area: pathOf(rings, true), label });
    };
    m.once('load', () => {
      // The box again: the style's own camera can win over the constructor's.
      m.resize();
      m.fitBounds(bounds, { padding, duration: 0 });
      // The credits start folded, behind their (i), as on the map page.
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      if (parkIds && muted) {
        // Only the park's name (drawn over the map, below): no other labels.
        for (const l of m.getStyle().layers) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none');
        m.once('idle', drawPark);
      }
      else if (parkIds) {
        const id = ['in', ['to-string', ['get', 'osm_id']], ['literal', parkIds]] as maplibregl.FilterSpecification;
        const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        m.addLayer({ id: 'feat-park-fill', type: 'fill', source: 'tiles1', 'source-layer': 'park', filter: id, paint: { 'fill-color': '#15803d', 'fill-opacity': 0.14 } }, before);
        m.addLayer({ id: 'feat-park-line', type: 'line', source: 'tiles1', 'source-layer': 'park_outline', filter: id, paint: { 'line-color': '#14532d', 'line-width': 2.5, 'line-opacity': 0.85 } }, before);
      }
      project();
    });
    // The box again at the map's settled size (it can change after it's
    // made, as the page lays out), then what's drawn over it.
    m.on('resize', () => { m.fitBounds(bounds, { padding, duration: 0 }); project(); drawPark(); });
    return () => m.remove();
  }, [seen, style, bounds, parkIds, overlay, muted, padding]);

  return <div role='img' aria-label={label} className={`relative overflow-hidden bg-[#eef2ea] ${className}`}>
    <div ref={box} className='absolute inset-0' />
    {park && <svg className='pointer-events-none absolute inset-0 h-full w-full' aria-hidden='true'>
      <defs>
        {/* The area's edge: the area grown by 2 px, less the area. */}
        <filter id={edge} x='-5%' y='-5%' width='110%' height='110%'>
          <feMorphology in='SourceAlpha' operator='dilate' radius='2' result='grown' />
          <feComposite in='grown' in2='SourceAlpha' operator='out' result='ring' />
          <feFlood floodColor='#14532d' />
          <feComposite in2='ring' operator='in' />
        </filter>
      </defs>
      <path d={park.area} fill='#15803d' fillOpacity='0.15' fillRule='nonzero' />
      <path d={park.area} fill='#000000' fillRule='nonzero' filter={`url(#${edge})`} />
      {parkName && park.label && <text x={park.label[0]} y={park.label[1]} textAnchor='middle' dominantBaseline='middle'
        fontSize='15' fontWeight='800' fill='#14532d' stroke='#ffffff' strokeWidth='4' strokeLinejoin='round' paintOrder='stroke'
        style={{ fontFamily: '"Hubot Sans", system-ui, sans-serif' }}>{parkName}</text>}
    </svg>}
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
