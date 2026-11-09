// The named-regressions page for hikeratlas/routes (components/Regressions):
// not linked from the site, and not for search engines.
import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import Regressions from '~/components/Regressions';
import { buildFor } from '~/build';
import { PMTILES_JS } from '~/components/nlDem';

export const handle: ExternalScriptsHandle = {
  scripts: [{ src: PMTILES_JS, crossOrigin: 'anonymous', async: false, defer: false, preload: true }],
};

export const meta: MetaFunction = () => [
  { title: "Hiker Atlas - Named regressions" },
  { name: "robots", content: "noindex" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => json({ build: buildFor(new URL(request.url)) });

export default function RegressionsPage() {
  const { build } = useLoaderData<typeof loader>();
  return <Regressions build={build} />;
}
