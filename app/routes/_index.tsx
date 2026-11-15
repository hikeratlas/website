// The homepage: app/content/home.mdx, with the featured park and hike
// (~/featured) for where the visitor is.
import { useLoaderData, type HeadersFunction, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import Home from '~/content/home.mdx';
import Featured from '~/components/Featured';
import { buildFor, styleUrl } from '~/build';
import { featured } from '~/featured';
import { posts } from '~/blog.server';

// The map's PMTiles script, for the featured park's map, in the site's frame.
import { handle as mapHandle } from './map';
export const handle = { ...mapHandle, fullscreen: false };

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
  return { featured: await featured(build, at, day, showcase).catch(() => null), style: styleUrl(preview), search: url.search, shots, latest: posts[0] ?? null };
};

// The featured cards, for home.mdx's <Featured />: one component for good,
// reading the loader's data, so switching parks re-renders it rather than
// mounting a new one (an inline component remounted the park switcher, which
// scrolled back to the start and then to the new park).
function FeaturedSlot() {
  const { featured: data, style, search, shots } = useLoaderData<typeof loader>();
  return <Featured data={data} style={style} search={search} shots={shots} />;
}

// The page's two columns from lg: the text, and the featured cards beside it.
// Narrower, one column, the cards last. Not for ?shots, whose cards are
// drawn at their pictures' sizes, wider than the side column.
function Columns({ children }: { children: React.ReactNode }) {
  const { shots } = useLoaderData<typeof loader>();
  return <div className={shots ? undefined : 'lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-x-12'}>{children}</div>;
}

// The newest blog post, and the way to the rest.
function LatestPost() {
  const { latest } = useLoaderData<typeof loader>();
  return <>
    {latest && <a href={latest.path} className='group mb-3 block rounded-2xl border border-stone-200 p-4 !text-stone-900 !no-underline shadow-sm transition hover:border-stone-400 hover:shadow-md'>
      <span className='text-xs font-semibold uppercase tracking-wider text-lime-800'>Latest post · {latest.date}</span>
      <span className='block font-display text-xl font-bold leading-snug group-hover:underline'>{latest.title}</span>
      <span className='block text-stone-700'>{latest.description}</span>
    </a>}
    <p><a href='/blog'>More posts →</a></p>
  </>;
}

const components = { Featured: FeaturedSlot, Columns, LatestPost };

export default function Index() {
  // home.mdx has the page's frame.
  return <Home components={components} />;
}
