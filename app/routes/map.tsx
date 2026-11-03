import { useEffect, useState } from 'react';
import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Map from '~/components/Map';
import RoutePlanner from '~/components/RoutePlanner';
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
  const [map, setMap] = useState(null);

  const onInitialized = (m) => setMap(m);
  const onSelect = (item: Item) => {
    if (!map)
      return;

    let camera = { center: item, zoom: 13 };
    if (item.min_lon || item.min_lat) {
      camera = map.cameraForBounds(
        [
          {
            lat: item.min_lat,
            lon: item.min_lon,
          },
          {
            lat: item.max_lat,
            lon: item.max_lon,
          }
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
        document.querySelector('.autosuggest input').focus();
        document.querySelector('.autosuggest input').select();
      }
    });
  }, []);

  return <>
      <div className='h-[100px] relative'>
        <div className='absolute top-3 right-3'><OsmLink map={map}/></div>
        <div className='p-2'>
          <h1 className='text-2xl'>
            Hiker Atlas
            {build && <span className='ml-2 text-sm text-gray-500'>preview: {build}</span>}
          </h1>
          <Search onSelect={onSelect} build={build}/>
        </div>
      </div>
      <div className='map-wrap'>
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
      </div>

  </>
}
