import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import MapPage from '~/components/MapPage';
import { buildFor } from '~/build';
import { PMTILES_JS } from '~/components/nlDem';

export const handle: ExternalScriptsHandle = {
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
  return json({ build: buildFor(url), search: url.search });
};

export default function Index() {
  const { build, search } = useLoaderData<typeof loader>();
  return <MapPage build={build} search={search} />;
}
