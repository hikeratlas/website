// The homepage's featured park and hike (see ~/featured): a card each,
// linking to their pages on the map. The park on the basemap, outlined, with
// its routes; the hike as an infographic, its shape and elevation profile
// with what it passes numbered on both.
import { lazy, Suspense, useMemo } from 'react';
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

export default function Featured({ data, style }: { data: Data | null; style: string }) {
  const hk = data?.hike;
  const overlay = useMemo(() => hk && ({ line: hk.coords, stops: hk.along.map((f) => ({ n: f.n, at: f.at })) }), [hk]);
  if (!data) return null;
  const { park, hike } = data;
  const days = park.counts.find(([, w]) => w === 'day hike')?.[0] ?? 0;
  return <section aria-label='Featured' className='my-6 grid gap-4 md:grid-cols-2'>
    <Card href={park.path} eyebrow={`${data.near ? 'A park near you' : 'Featured park'} · ${park.region}`}
      art={<Suspense fallback={<div className='h-[220px] md:h-[260px]' />}>
        <MiniMap style={style} bounds={park.bounds} parkId={park.id} label={`A map of ${park.name}`} className='h-[220px] md:h-[260px]' />
      </Suspense>}>
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
      art={<div className='flex h-[200px] bg-white md:h-[220px]'>
        <Suspense fallback={<div className='w-[48%]' />}>
          <MiniMap style={style} bounds={hike.bounds} overlay={overlay} muted padding={22} label={`A map of ${hike.title}`} className='w-[48%] shrink-0' />
        </Suspense>
        <div className='min-w-0 flex-1 px-1 py-2'><HikeGraphic hike={hike} /></div>
      </div>}>
      <span className='font-display text-2xl font-extrabold leading-tight tracking-tight'>{hike.title}</span>
      <span className='text-sm text-stone-700'>
        <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_COLORS[hike.diff]}`}>{hike.diff}</span>
        {hike.km.toFixed(1)} km · ↑ {Math.round(hike.gain).toLocaleString('en-US')} m · {hike.time} · {hike.loop ? 'loop' : 'out & back'} · from {hike.from}
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
  </section>;
}
