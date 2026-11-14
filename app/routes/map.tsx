import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import MapPage from '~/components/MapPage';
import { buildFor } from '~/build';
import { PMTILES_JS } from '~/components/nlDem';

// fullscreen: no site frame (root.tsx).
export const handle: ExternalScriptsHandle & { fullscreen: boolean } = {
  fullscreen: true,
  scripts: [
    {
      src: PMTILES_JS,
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
  const url = new URL(request.url);
  return { build: buildFor(url), search: url.search };
};

export default function Index() {
  const { build, search } = useLoaderData<typeof loader>();
  return <MapPage build={build} search={search} />;
}
