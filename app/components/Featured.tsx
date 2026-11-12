// The homepage's featured park and hike (see ~/featured): a card each,
// linking to their pages on the map. The park on the basemap, outlined, with
// its routes; the hike as an infographic, its shape and elevation profile
// with what it passes numbered on both.
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Link } from '@remix-run/react';
import type { Featured as Data } from '~/featured';
import { DIFF_COLORS } from '~/park';
import { TerrainBar } from './ParkSheet';
import HikeGraphic from './HikeGraphic';

// MapLibre only in the browser, and only for the homepage's map.
const MiniMap = lazy(() => import('./MiniMap'));

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;

function Card({ href, eyebrow, children, art }: { href: string; eyebrow: string; children: React.ReactNode; art: React.ReactNode }) {
  return <a href={href} className='group flex flex-col overflow-hidden rounded-2xl border border-stone-200 !text-stone-900 !no-underline shadow-sm transition hover:border-stone-400 hover:shadow-md'>
    <div className='bg-[#eef2ea]'>{art}</div>
    <div className='flex flex-1 flex-col gap-1.5 p-4'>
      <span className='text-xs font-semibold uppercase tracking-wider text-lime-800'>{eyebrow}</span>
      {children}
    </div>
  </a>;
}

const CTA = 'mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-green-900 px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-green-800';

// The showcase parks, by short name, on one line (scrolling sideways when
// it's too long), the featured one marked: a reader can switch the cards to
// another park (?showcase=N, keeping the rest of the query, a preview's
// ?build=). Remix links, so only the cards' data loads, and the page stays put.
function ParkSwitcher({ showcase, search }: { showcase: Data['showcase']; search: string }) {
  const { index, names } = showcase;
  const row = useRef<HTMLDivElement>(null);
  const to = (i: number) => {
    const q = new URLSearchParams(search);
    q.set('showcase', String((i + names.length) % names.length));
    return `?${q}`;
  };
  // The featured park in view in the line: centred, only if it isn't all
  // in view already (a click on a park in view leaves the line be).
  useEffect(() => {
    const r = row.current, el = r?.querySelector<HTMLElement>('[aria-current]');
    if (!r || !el) return;
    const left = el.offsetLeft - r.offsetLeft, right = left + el.offsetWidth;
    if (left >= r.scrollLeft && right <= r.scrollLeft + r.clientWidth) return;
    r.scrollTo({ left: left - r.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [index]);
  const arrow = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-300 !text-stone-700 !no-underline hover:bg-stone-100';
  return <nav aria-label='Showcase parks' className='mt-6 -mb-3 flex items-center gap-2'>
    <Link to={to(index - 1)} preventScrollReset aria-label='Previous park' className={arrow}>«</Link>
    <div ref={row} className='flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      {names.map((n, i) => <Link key={n} to={to(i)} preventScrollReset aria-current={i === index ? 'true' : undefined}
        className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm !no-underline ${i === index ? 'bg-green-900 font-semibold !text-white' : '!text-stone-700 hover:bg-stone-100'}`}>{n}</Link>)}
    </div>
    <Link to={to(index + 1)} preventScrollReset aria-label='Next park' className={arrow}>»</Link>
  </nav>;
}

// The cards' pictures are drawn at these sizes (CSS px; bin/home-images.mjs
// takes them at 2x), and shown at the card's width in their proportions.
const PARK_ART = { w: 480, h: 300 };
const HIKE_ART = { w: 480, h: 220 };

// shots: the cards drawn live at their pictures' sizes, without the map's
// credits (the page has them), for basemap's bin/home-images.mjs, which
// pictures them for each build (#116); otherwise those pictures where the
// build has them, as two MapLibre maps and an elevation profile from the DEM
// were heavy for a page's first look. Without them, live.
export default function Featured({ data, style, search = '', shots = false }: { data: Data | null; style: string; search?: string; shots?: boolean }) {
  const hk = data?.hike;
  const overlay = useMemo(() => hk && ({ line: hk.coords, stops: hk.along.map((f) => ({ n: f.n, at: f.at })) }), [hk]);
  if (!data) return null;
  const { park, hike } = data;
  const days = park.counts.find(([, w]) => w === 'day hike')?.[0] ?? 0;
  const images = shots ? null : data.images;
  const parkArt = images
    ? <img src={images.park} alt={`A map of ${park.name}`} width={PARK_ART.w} height={PARK_ART.h} className='block aspect-[8/5] w-full object-cover' />
    : shots
      ? <div data-shot='park' data-shot-name={park.slug} style={{ width: PARK_ART.w, height: PARK_ART.h }}>
        <Suspense fallback={null}>
          <MiniMap style={style} bounds={park.bounds} parkIds={park.ids} parkName={park.name} muted credits={false} label={`A map of ${park.name}`} className='h-full w-full' />
        </Suspense>
      </div>
      : <Suspense fallback={<div className='h-[220px] md:h-[260px]' />}>
        <MiniMap style={style} bounds={park.bounds} parkIds={park.ids} parkName={park.name} muted label={`A map of ${park.name}`} className='h-[220px] md:h-[260px]' />
      </Suspense>;
  const hikeArt = images
    ? <img src={images.hike} alt={`A map of ${hike.title} and its elevation profile`} width={HIKE_ART.w} height={HIKE_ART.h} className='block aspect-[24/11] w-full bg-white object-cover' />
    : <div data-shot={shots ? 'hike' : undefined} data-shot-name={shots ? park.slug : undefined}
      className={`flex bg-white ${shots ? '' : 'h-[200px] md:h-[220px]'}`} style={shots ? { width: HIKE_ART.w, height: HIKE_ART.h } : undefined}>
      <Suspense fallback={<div className='w-[48%]' />}>
        <MiniMap style={style} bounds={hike.bounds} overlay={overlay} muted padding={22} credits={!shots} label={`A map of ${hike.title}`} className='w-[48%] shrink-0' />
      </Suspense>
      <div className='min-w-0 flex-1 px-1 py-2'><HikeGraphic hike={hike} /></div>
    </div>;
  return <>
  <ParkSwitcher showcase={data.showcase} search={search} />
  <section aria-label='Featured' className='my-6 grid gap-4 md:grid-cols-2'>
    <Card href={park.path} eyebrow={`${data.near ? 'A park near you' : 'Featured park'} · ${park.region}`}
      art={parkArt}>
      <span className='font-display text-2xl font-extrabold leading-tight tracking-tight'>{park.name}</span>
      <span className='text-sm text-stone-700'>{park.counts.map(([n, w]) => plural(n, w)).join(' · ')}</span>
      {park.starts.length > 0 && <span className='mt-1 flex flex-col gap-0.5 text-sm'>
        <span className='text-stone-500'>Start with</span>
        {park.starts.map((st) => <span key={st.tag} className='grid grid-cols-[4.5rem_1fr] items-baseline text-stone-800'>
          <span className='text-xs font-semibold uppercase tracking-wide text-stone-500'>{st.tag}</span>
          <span>{st.title} <span className='text-stone-500'>· {st.km.toFixed(1)} km</span></span>
        </span>)}
      </span>}
      <span className='mt-auto pt-3'><span className={CTA}>Explore its {days} {days === 1 ? 'hike' : 'hikes'} <span aria-hidden='true'>→</span></span></span>
    </Card>

    <Card href={hike.path} eyebrow={`Featured hike · ${park.name}`}
      art={hikeArt}>
      <span className='font-display text-2xl font-extrabold leading-tight tracking-tight'>{hike.title}</span>
      <span className='text-sm text-stone-700'>
        <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_COLORS[hike.diff]}`}>{hike.diff}</span>
        {hike.km.toFixed(1)} km · ↑ {Math.round(hike.gain).toLocaleString('en-US')} m · {hike.time} · {hike.shape} · from {hike.from}
      </span>
      <TerrainBar landcover={hike.landcover} className='h-[5px] w-40' />
      {hike.along.length > 0
        ? <ol className='!m-0 !list-none !p-0 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm text-stone-700 sm:grid-cols-2'>
          {hike.along.map((f) => <li key={f.n} className='flex items-center gap-1.5'>
            <span className='flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-fuchsia-700 text-[9px] font-bold text-white'>{f.n}</span>
            <span className='truncate'>{f.name}</span>
          </li>)}
        </ol>
        : hike.passes.length > 0 && <span className='text-sm text-stone-700'>Passes {hike.passes.join(', ')}</span>}
      {hike.reports > 0 && <span className='text-sm text-stone-700'>{plural(hike.reports, 'trip report')} from hikers who&apos;ve done it</span>}
      <span className='mt-auto pt-3'><span className={CTA}>See the hike <span aria-hidden='true'>→</span></span></span>
    </Card>
  </section>
  {images && <p className='-mt-3 mb-6 text-xs text-stone-500'>
    Maps © <a href='https://www.openstreetmap.org/copyright' className='!text-stone-500'>OpenStreetMap</a> contributors;
    elevation from <a href='https://mapterhorn.com/attribution' className='!text-stone-500'>Mapterhorn</a>.
  </p>}
  </>;
}
