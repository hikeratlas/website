// Phones: the map page has no title bar, so its links (home, your saved hikes
// or signing in, terms; signing out and OpenStreetMap at the bottom) are in a
// drawer, opened by the menu button beside the search box. Closed by its ×,
// by tapping the map beside it, or by Escape.
import { useEffect, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Avatar, SignInDialog } from '~/components/Account';
import OsmLink from '~/components/OsmLink';
import { signOut, useAtSession } from '~/atproto/session';

const item = 'tap-row text-left text-base text-blue-700 hover:underline';

export default function MapMenu({ map }: { map: MaplibreMap | null }) {
  const at = useAtSession();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const who = at.status === 'in' ? at.handle ?? at.did : null;
  return <>
    <button type='button' onClick={() => setOpen(true)} aria-label='Menu' aria-expanded={open}
      className='map-menu-button flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-stone-700 shadow-[0_1px_4px_rgba(0,0,0,0.25)]'>
      <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden='true'>
        <path d='M4 7h16M4 12h16M4 17h16' />
      </svg>
    </button>
    {open && <div className='fixed inset-0 z-30' role='dialog' aria-modal='true' aria-label='Menu'>
      <button type='button' aria-label='Close menu' onClick={() => setOpen(false)} className='absolute inset-0 bg-black/40' />
      <nav className='absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-1 bg-white p-4 shadow-xl'>
        <div className='mb-3 flex items-center justify-between'>
          <a href='/' className='flex items-center gap-2 font-display text-xl font-extrabold text-stone-900'>
            <img src='/favicon.svg' alt='' width={28} height={28} className='rounded-md' />
            Hiker Atlas
          </a>
          <button type='button' onClick={() => setOpen(false)} aria-label='Close menu'
            className='flex h-11 w-11 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100'>
            <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden='true'>
              <path d='M6 6l12 12M18 6L6 18' />
            </svg>
          </button>
        </div>
        <a href='/' className={item}>Home</a>
        {at.status === 'in' && who
          ? <a href={`/people/${encodeURIComponent(who)}`} className={`${item} flex items-center gap-2`}>
            <Avatar src={at.avatar} name={at.handle ?? '?'} />Your saved hikes
          </a>
          : at.status === 'out' && <button type='button' className={item} onClick={() => { setOpen(false); setAsking(true); }}>Sign in</button>}
        <a href='/terms' className={item}>Terms &amp; privacy</a>
        {/* The bottom line: Sign out, and (niche) this view on OpenStreetMap. */}
        <div className='mt-auto flex items-center justify-between'>
          {at.status === 'in'
            ? <button type='button' className='tap text-left text-base text-blue-700 hover:underline' onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
            : <span />}
          <OsmLink map={map} className='tap inline-flex items-center justify-end gap-0.5 text-sm text-blue-700 hover:underline' />
        </div>
      </nav>
    </div>}
    {asking && <SignInDialog onClose={() => setAsking(false)} />}
  </>;
}
