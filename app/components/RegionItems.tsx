// A /hikes index page's list (#110): a state's parks as cards (each with its
// outline, kind, hike count, best hike and what its hikes pass), or a
// country's states (or the countries) as tiles comparing their hikes. The
// cards' extras come from the build's routes bundle (basemap's
// hike-paths.py); until they're in, or in a build without them, a card
// shows what regions.json has.
import { useEffect, useState } from 'react';
import { bundleIndex } from '~/components/CuratedRoutes';
import { parkLabel, stateCards, type Card, type RegionItem } from '~/hikes';

export default function RegionItems({ items, build, cards, onNavigate }: {
  items: RegionItem[];
  build: string;
  // The state's key in the build's cards, on a state's page.
  cards?: string;
  onNavigate?: (path: string) => void;
}) {
  const [extra, setExtra] = useState<Record<string, Card> | null>(null);
  useEffect(() => {
    setExtra(null);
    if (!cards) return;
    let live = true;
    bundleIndex(build).then((index) => stateCards(build, index, cards)).then((c) => { if (live) setExtra(c); }).catch(() => {});
    return () => { live = false; };
  }, [build, cards]);

  const go = (path: string) => (e: React.MouseEvent) => {
    if (onNavigate && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onNavigate(path); }
  };

  // Parks, as cards.
  if (items.some((i) => i.id)) {
    return <ul className='mt-2 flex flex-col gap-2'>
      {/* One edge filter for every outline: the area grown, less the area,
          so tile seams between an outline's pieces never show. */}
      <svg width='0' height='0' className='absolute' aria-hidden='true'>
        <filter id='park-edge' x='-10%' y='-10%' width='120%' height='120%'>
          <feMorphology in='SourceAlpha' operator='dilate' radius='3' result='grown' />
          <feComposite in='grown' in2='SourceAlpha' operator='out' result='ring' />
          <feFlood floodColor='#14532d' />
          <feComposite in2='ring' operator='in' />
        </filter>
      </svg>
      {items.map((it) => {
        const c = it.id ? extra?.[it.id] : undefined;
        const l = parkLabel(it.name, it.id);
        return <li key={it.path}>
          <a href={it.path} onClick={go(it.path)}
            className='flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-2.5 text-stone-900 hover:border-stone-300 hover:bg-stone-50'>
            <span className='flex h-16 w-16 flex-none items-center justify-center rounded-lg bg-[#eef2ea]'>
              {c?.outline
                ? <svg viewBox='-6 -6 112 112' className='h-14 w-14' aria-hidden='true'>
                  <path d={c.outline} fill='#15803d' fillOpacity='0.18' fillRule='nonzero' />
                  <path d={c.outline} fill='#000' fillRule='nonzero' filter='url(#park-edge)' />
                </svg>
                : <svg viewBox='0 0 24 24' className='h-7 w-7 text-green-800/60' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinejoin='round' aria-hidden='true'>
                  <path d='M3 19 9.5 8l3.5 6 2-3 6 8z' />
                </svg>}
            </span>
            <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
              {l.kind && <span className='text-xs text-stone-500'>{l.kind}</span>}
              <span className='font-display text-[17px] font-bold leading-tight'>{l.name}</span>
              {l.near && <span className='text-xs text-stone-500'>{l.near}</span>}
              <span className='text-[13px] text-stone-600'>
                <b className='text-fuchsia-800'>{it.meta}</b>
                {c?.top && <> · top pick: {c.top}</>}
              </span>
              {c?.tags && c.tags.length > 0 && <span className='mt-0.5 flex flex-wrap gap-1'>
                {c.tags.map((t) => <span key={t} className='rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-700'>{t}</span>)}
              </span>}
            </span>
          </a>
        </li>;
      })}
    </ul>;
  }

  // States or countries, as tiles: a bar for their hikes against the most.
  const most = Math.max(1, ...items.map((i) => i.hikes ?? 0));
  if (items.some((i) => i.hikes !== undefined)) {
    return <ul className='mt-2 grid grid-cols-2 gap-2.5'>
      {items.map((it) => <li key={it.path} className='flex'>
        <a href={it.path} onClick={go(it.path)}
          className='flex w-full flex-col gap-1 rounded-xl border border-stone-200 bg-white p-3 text-stone-900 hover:border-stone-300 hover:bg-stone-50'>
          <span className='font-display text-[15px] font-bold leading-tight'>{it.name}</span>
          <span className='font-display text-[26px] font-extrabold leading-none text-fuchsia-800'>{(it.hikes ?? 0).toLocaleString('en-US')}</span>
          <span className='text-xs text-stone-600'>{it.hikes === 1 ? 'hike' : 'hikes'} in {(it.parks ?? 0).toLocaleString('en-US')} {it.parks === 1 ? 'park' : 'parks'}</span>
          <span className='h-1.5 overflow-hidden rounded-full bg-stone-100'>
            <span className='block h-full rounded-full bg-fuchsia-600' style={{ width: `${Math.max(2, ((it.hikes ?? 0) / most) * 100)}%` }} />
          </span>
          {it.top && <span className='mt-auto pt-0.5 text-xs text-stone-600'>Most: <b className='text-green-900'>{parkLabel(it.top).name}</b></span>}
        </a>
      </li>)}
    </ul>;
  }

  // Anything else ("Did you mean"): a plain list.
  return <ul className='mt-1'>
    {items.map((it) => <li key={it.path} className='py-0.5'>
      <a href={it.path} onClick={go(it.path)} className='tap-row text-blue-700 hover:underline'>{it.name}</a>
      {it.meta && <span className='ml-1.5 text-xs text-gray-500'>{it.meta}</span>}
    </li>)}
  </ul>;
}
