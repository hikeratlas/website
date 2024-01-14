import type { MetaFunction } from "@remix-run/cloudflare";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Map from '~/components/Map';

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
  return <>
      <div style={{height: '100px'}}>
        <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
          <h1>Hiker Atlas</h1>
        </div>
      </div>
      <div className='map-wrap'>
        <Map/>
      </div>
  </>
}
