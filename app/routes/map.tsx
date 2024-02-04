import { useState } from 'react';
import type { MetaFunction } from "@remix-run/cloudflare";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Map from '~/components/Map';
import Search, { Item } from '~/components/Search';

export const handle: ExternalScriptsHandle = {
  scripts: [
    {
      src: "https://unpkg.com/pmtiles@2.5.0/dist/index.js",
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

export default function Index() {
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


  return <>
      <div className='h-[100px]'>
        <div className='p-2'>
          <h1 className='text-2xl'>Hiker Atlas</h1>
          <Search onSelect={onSelect}/>
        </div>
      </div>
      <div className='map-wrap'>
        <Map
          style="https://public.hikeratlas.com/style.json"
          lng={-118.245}
          lat={51.537}
          zoom={6.5}
          maxBounds={[-170, 20, -48, 75]}
          onInitialized={onInitialized}
        />
      </div>
  </>
}
