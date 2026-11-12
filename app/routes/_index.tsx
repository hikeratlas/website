// The homepage: app/content/home.mdx, with the featured park and hike
// (~/featured) for where the visitor is.
import { useLoaderData, type HeadersFunction, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import Home from '~/content/home.mdx';
import Featured from '~/components/Featured';
import { buildFor, styleUrl } from '~/build';
import { featured } from '~/featured';

// The map's PMTiles script, for the featured park's map.
export { handle } from './map';

export const meta: MetaFunction = () => [
  { title: 'Hiker Atlas' },
  { name: 'description', content: 'Explore hiking trails and plan your next trip, plus notes about the development of Hiker Atlas and open-source cartography in general.' },
];

// Per visitor (the park near them), so not cached.
export const headers: HeadersFunction = () => ({ 'Cache-Control': 'no-cache' });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const preview = buildFor(url);
  const build = preview ?? 'north-america';
  // Cloudflare's guess at where the visitor is, from their IP.
  const cf = (request as Request & { cf?: { latitude?: string; longitude?: string } }).cf;
  const lat = Number(cf?.latitude), lon = Number(cf?.longitude);
  const at: [number, number] | null = cf?.latitude && cf?.longitude && Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
  const day = Math.floor(Date.now() / 86_400_000);
  // ?showcase=N: showcase park N, to check them one by one.
  const n = Number(url.searchParams.get('showcase'));
  const showcase = url.searchParams.has('showcase') && Number.isInteger(n) ? n : null;
  // ?shots: the cards drawn live, for basemap's bin/home-images.mjs to
  // picture them.
  const shots = url.searchParams.has('shots');
  return { featured: await featured(build, at, day, showcase).catch(() => null), style: styleUrl(preview), search: url.search, shots };
};

// The featured cards, for home.mdx's <Featured />: one component for good,
// reading the loader's data, so switching parks re-renders it rather than
// mounting a new one (an inline component remounted the park switcher, which
// scrolled back to the start and then to the new park).
function FeaturedSlot() {
  const { featured: data, style, search, shots } = useLoaderData<typeof loader>();
  return <Featured data={data} style={style} search={search} shots={shots} />;
}
const components = { Featured: FeaturedSlot };

export default function Index() {
  // home.mdx has the page's frame.
  return <Home components={components} />;
}
