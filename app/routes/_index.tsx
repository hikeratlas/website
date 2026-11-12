// The homepage: app/content/home.mdx, with the featured park and hike
// (~/featured) for where the visitor is.
import { json } from '@remix-run/cloudflare';
import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import Home from '~/content/home.mdx';
import Featured from '~/components/Featured';
import { buildFor } from '~/build';
import { featured } from '~/featured';

export const meta: MetaFunction = () => [
  { title: 'Hiker Atlas' },
  { name: 'description', content: 'Explore hiking trails and plan your next trip, plus notes about the development of Hiker Atlas and open-source cartography in general.' },
];

// Per visitor (the park near them), so not cached.
export const headers: HeadersFunction = () => ({ 'Cache-Control': 'no-cache' });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const build = buildFor(url) ?? 'north-america';
  // Cloudflare's guess at where the visitor is, from their IP.
  const cf = (request as Request & { cf?: { latitude?: string; longitude?: string } }).cf;
  const lat = Number(cf?.latitude), lon = Number(cf?.longitude);
  const at: [number, number] | null = cf?.latitude && cf?.longitude && Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
  const day = Math.floor(Date.now() / 86_400_000);
  return json({ featured: await featured(build, at, day).catch(() => null) });
};

export default function Index() {
  const { featured: data } = useLoaderData<typeof loader>();
  // home.mdx has the page's frame.
  return <Home components={{ Featured: () => <Featured data={data} /> }} />;
}
