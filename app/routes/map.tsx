import { useEffect, useState } from 'react';
import type { Map as MaplibreMap, JumpToOptions } from 'maplibre-gl';
import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Map from '~/components/Map';
import RoutePlanner from '~/components/RoutePlanner';
import CuratedRoutes from '~/components/CuratedRoutes';
import OsmLink from '~/components/OsmLink';
import Search, { Item } from '~/components/Search';
import { buildFor, styleUrl, tilesUrl } from '~/build';

export const handle: ExternalScriptsHandle = {
  scripts: [
    {
      src: "https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js",
      //integrity: "sha384-FhXw7b6AlE/jyjlZH5iHa/tTe9EpJ1Y55RjcgPbjeWMskSxZt1v9qkxLJWNJaGni",
      crossOrigin: 'anonymous',
      async: false,
      defer: false,
      preload: true, // use it to render a <link rel="preload"> for this script
    }
  ],
};

export const meta: MetaFunction = () => {
  return [
    { title: "Hiker Atlas - Map" },
    { name: "description", content: "Browse and plot trails on a map." },
  ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ build: buildFor(new URL(request.url)) });
};

export default function Index() {
  const { build } = useLoaderData<typeof loader>();
  const [map, setMap] = useState<MaplibreMap | null>(null);
  // A park picked in search, to list its curated hikes.
  const [focusPark, setFocusPark] = useState<{ id: string; name: string; at: number } | null>(null);

  const onInitialized = (m: MaplibreMap) => setMap(m);
  // Where search should prefer results near (#44): the map's centre, unless
  // it's zoomed out past a region, where "near" means little.
  const near = () => {
    if (!map || map.getZoom() < 5) return null;
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  };
  const onSelect = (item: Item) => {
    if (!map)
      return;

    let camera: JumpToOptions = { center: item, zoom: 13 };
    if (item.min_lon != null && item.min_lat != null && item.max_lon != null && item.max_lat != null) {
      camera = map.cameraForBounds(
        [
          [item.min_lon, item.min_lat],
          [item.max_lon, item.max_lat],
        ],
        {
          padding: {
            top: 100,
            bottom: 100,
            left: 100,
            right: 100
          }
        }
      ) || camera;
    }

    map.jumpTo(camera);
    if (item.kind === 'park') setFocusPark({ id: String(item.osm_id), name: item.name, at: Date.now() });
  }

  useEffect(() => {
    document.addEventListener('keydown', function(event) {
      const isTextInputFocused = (): boolean => {
          const activeElement = document.activeElement;

          // Check if the focused element is an input or textarea
          return activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      };

      if (!isTextInputFocused() && event.key === '/') {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.autosuggest input');
        input?.focus();
        input?.select();
      }
    });
  }, []);

  return <>
      {/* On phones the title bar goes and search floats on the map (see
          .map-header in map.css), so the map gets the whole screen. */}
      <div className='map-header relative'>
        <div className='map-header-osm absolute top-3 right-3'><OsmLink map={map}/></div>
        <div className='p-2'>
          <h1 className='map-header-title text-2xl'>
            Hiker Atlas
            {build && <span className='ml-2 text-sm text-gray-500'>preview: {build}</span>}
          </h1>
          <div className='map-search'><Search onSelect={onSelect} build={build} near={near}/></div>
        </div>
      </div>
      <div className='map-wrap'>
        {/* Phones: the header's OSM link is hidden with the title bar, so it
            sits on the map instead (see .map-osm-mobile in map.css). */}
        <div className='map-osm-mobile'><OsmLink map={map}/></div>
        {/* A build only covers its own area, so don't constrain it to North
            America; start at its tiles' center instead. */}
        <Map
          style={styleUrl(build)}
          lng={-118.245}
          lat={51.537}
          zoom={6.5}
          maxBounds={build ? undefined : [-170, 20, -48, 75]}
          centerOnPmtiles={build ? tilesUrl(build) : undefined}
          onInitialized={onInitialized}
        />
        <RoutePlanner map={map} tiles={tilesUrl(build ?? 'north-america')} />
        <CuratedRoutes map={map} build={build ?? 'north-america'} focusPark={focusPark} />
      </div>

  </>
}
