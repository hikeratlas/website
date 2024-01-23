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
    if (map)
      map.jumpTo({ center: item });
  }


  return <>
      <div className='h-[100px]'>
        <div className='p-2'>
          <h1 className='text-2xl'>Hiker Atlas</h1>
          <Search onSelect={onSelect}/>
        </div>
      </div>
      <div className='map-wrap'>
        <Map onInitialized={onInitialized}/>
      </div>
  </>
}
