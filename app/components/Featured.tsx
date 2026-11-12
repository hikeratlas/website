// The homepage's featured park and hike (see ~/featured): a card each, with
// the routes drawn as on the map, linking to their pages on the map.
import type { Featured as Data } from '~/featured';
import { DIFF_COLORS } from '~/park';
import { TerrainBar } from './ParkSheet';

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

export default function Featured({ data }: { data: Data | null }) {
  if (!data) return null;
  const { park, hike } = data;
  return <section aria-label='Featured' className='my-6 grid gap-4 md:grid-cols-2'>
    <Card href={park.path} eyebrow={`${data.near ? 'A park near you' : 'Featured park'} · ${park.region}`}
      art={<svg viewBox='0 0 320 180' className='block h-auto w-full' role='img' aria-label={`The hikes in ${park.name}`}>
        {park.lines.map((pts, i) => <polyline key={i} points={pts} fill='none' stroke='#c026d3' strokeOpacity={0.75} strokeWidth={1.6} strokeLinejoin='round' strokeLinecap='round' />)}
      </svg>}>
      <span className='font-display text-2xl font-extrabold leading-tight tracking-tight'>{park.name}</span>
      <span className='text-sm text-stone-700'>{park.counts.map(([n, w]) => plural(n, w)).join(' · ')}</span>
      <span className='mt-auto pt-2 text-sm font-semibold text-green-900 group-hover:underline'>See its hikes on the map →</span>
    </Card>

    <Card href={hike.path} eyebrow={`Featured hike · ${park.name}`}
      art={<svg viewBox='0 0 320 180' className='block h-auto w-full' role='img' aria-label={`The route of ${hike.title}`}>
        <polyline points={hike.line} fill='none' stroke='#ffffff' strokeWidth={7} strokeLinejoin='round' strokeLinecap='round' />
        <polyline points={hike.line} fill='none' stroke='#c026d3' strokeWidth={3.5} strokeLinejoin='round' strokeLinecap='round' />
      </svg>}>
      <span className='flex items-center gap-2'>
        <span className='font-display text-2xl font-extrabold leading-tight tracking-tight'>{hike.title}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_COLORS[hike.diff]}`}>{hike.diff}</span>
      </span>
      <span className='text-sm text-stone-700'>
        {hike.km.toFixed(1)} km · ↑ {Math.round(hike.gain).toLocaleString('en-US')} m · {hike.time} · {hike.loop ? 'loop' : 'out & back'} · from {hike.from}
      </span>
      <TerrainBar landcover={hike.landcover} className='h-[5px] w-40' />
      {hike.passes.length > 0 && <span className='text-sm text-stone-700'>Passes {hike.passes.join(', ')}</span>}
      {hike.reports > 0 && <span className='text-sm text-stone-700'>{plural(hike.reports, 'trip report')} from hikers who&apos;ve done it</span>}
      <span className='mt-auto pt-2 text-sm font-semibold text-green-900 group-hover:underline'>See the hike →</span>
    </Card>
  </section>;
}
