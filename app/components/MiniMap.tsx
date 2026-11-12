// A small, still map (no panning, zooming or controls but the credits): the
// basemap of a box, with routes drawn on it and a park outlined, for the
// homepage's featured park. It starts only once it's scrolled into view, so
// the homepage doesn't load the map until it's seen. The tiles are set up as
// Map does (its zstd PMTiles, contours and Newfoundland DEM protocols).
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

export default function MiniMap({ style, bounds, routes, parkId, label }: {
  style: string;
  bounds: [number, number, number, number];
  routes: [number, number][][];
  parkId: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

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
      fitBoundsOptions: { padding: 12 },
      interactive: false,
      transformRequest: demTransformRequest,
      attributionControl: { compact: true },
    });
    m.once('load', () => {
      // The credits start folded, behind their (i), as on the map page.
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      const id = ['==', ['to-string', ['get', 'osm_id']], parkId] as maplibregl.FilterSpecification;
      const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      // The park, tinted and outlined, whichever of its layers has its id.
      m.addLayer({ id: 'feat-park-fill', type: 'fill', source: 'tiles1', 'source-layer': 'park', filter: id, paint: { 'fill-color': '#15803d', 'fill-opacity': 0.12 } }, before);
      m.addLayer({ id: 'feat-park-line', type: 'line', source: 'tiles1', 'source-layer': 'park_outline', filter: id, paint: { 'line-color': '#14532d', 'line-width': 2, 'line-opacity': 0.8 } }, before);
      m.addSource('feat-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: routes.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) } });
      m.addLayer({ id: 'feat-routes-casing', type: 'line', source: 'feat-routes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3.5 } });
      m.addLayer({ id: 'feat-routes', type: 'line', source: 'feat-routes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c026d3', 'line-width': 2 } });
    });
    return () => m.remove();
  }, [seen, style, bounds, routes, parkId]);

  return <div ref={box} role='img' aria-label={label} className='relative h-[220px] w-full bg-[#eef2ea] md:h-[260px]' />;
}
