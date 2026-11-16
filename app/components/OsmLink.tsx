import { useEffect, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';

// Links to the same place on another map (openstreetmap.org, Google Maps),
// kept up to date as the map moves. Their tiles are 256px and ours are 512px,
// so the same view is one zoom level higher there; their URLs take whole
// zoom levels.
const theirZoom = (zoom: number, max: number) => Math.min(max, Math.max(0, Math.round(zoom + 1)));

export function osmUrl(lng: number, lat: number, zoom: number): string {
  return `https://www.openstreetmap.org/#map=${theirZoom(zoom, 19)}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
}

// Google's documented Maps URLs (https://developers.google.com/maps/documentation/urls/get-started),
// on its terrain basemap (#172). Zoom 0-21.
export function googleMapsUrl(lng: number, lat: number, zoom: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat.toFixed(5)},${lng.toFixed(5)}&zoom=${theirZoom(zoom, 21)}&basemap=terrain`;
}

const LINK_CLASS = 'inline-flex items-center gap-0.5 text-sm text-gray-500 hover:text-gray-800';

function MapLink({ map, urlFor, label, title, className = LINK_CLASS }: {
  map: MaplibreMap | null;
  urlFor: (lng: number, lat: number, zoom: number) => string;
  label: string;
  title: string;
  className?: string;
}) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setHref(urlFor(c.lng, c.lat, map.getZoom()));
    };
    update();
    map.on('moveend', update);
    return () => { map.off('moveend', update); };
  }, [map, urlFor]);

  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className}
    >
      {label}
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3H3v10h10v-3" />
        <path d="M9 3h4v4" />
        <path d="M13 3L7 9" />
      </svg>
    </a>
  );
}

export default function OsmLink({ map, label = 'OSM', className }: { map: MaplibreMap | null; label?: string; className?: string }) {
  return <MapLink map={map} urlFor={osmUrl} label={label} title='Open this view on OpenStreetMap' className={className} />;
}

export function GoogleMapsLink({ map, label = 'Google', className }: { map: MaplibreMap | null; label?: string; className?: string }) {
  return <MapLink map={map} urlFor={googleMapsUrl} label={label} title='Open this view on Google Maps' className={className} />;
}
