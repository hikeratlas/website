// The trace picker for routes' named regressions (components/TracePicker):
// not linked from the site, and not for search engines.
import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { ExternalScriptsHandle } from "remix-utils/external-scripts";
import TracePicker from '~/components/TracePicker';
import { buildFor } from '~/build';
import { PMTILES_JS } from '~/components/nlDem';

export const handle: ExternalScriptsHandle = {
  scripts: [{ src: PMTILES_JS, crossOrigin: 'anonymous', async: false, defer: false, preload: true }],
};

export const meta: MetaFunction = () => [
  { title: "Hiker Atlas - Trace picker" },
  { name: "robots", content: "noindex" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => json({ build: buildFor(new URL(request.url)) });

export default function TracePickerPage() {
  const { build } = useLoaderData<typeof loader>();
  return <TracePicker build={build} />;
}
