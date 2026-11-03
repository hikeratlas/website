import React, { useEffect, useState } from 'react';

// A link to the same place on openstreetmap.org, kept up to date as the map
// moves. OSM's tiles are 256px and ours are 512px, so the same view is one
// zoom level higher there; OSM's URLs take whole zoom levels.
export function osmUrl(lng: number, lat: number, zoom: number): string {
  const z = Math.min(19, Math.max(0, Math.round(zoom + 1)));
  return `https://www.openstreetmap.org/#map=${z}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
}

export default function OsmLink({ map }: { map: any }) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setHref(osmUrl(c.lng, c.lat, map.getZoom()));
    };
    update();
    map.on('moveend', update);
    return () => { map.off('moveend', update); };
  }, [map]);

  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this view on OpenStreetMap"
      className="inline-flex items-center gap-0.5 text-sm text-gray-500 hover:text-gray-800"
    >
      OSM
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3H3v10h10v-3" />
        <path d="M9 3h4v4" />
        <path d="M13 3L7 9" />
      </svg>
    </a>
  );
}
