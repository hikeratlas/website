// Phones: the map page has no title bar, so its links (home, signing in,
// OpenStreetMap, terms) are in a drawer, opened by the menu button beside
// the search box.
import { useEffect, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { AccountButton } from '~/components/Account';
import OsmLink from '~/components/OsmLink';

export default function MapMenu({ map }: { map: MaplibreMap | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
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
        <a href='/' className='mb-3 flex items-center gap-2 font-display text-xl font-extrabold text-stone-900'>
          <img src='/favicon.svg' alt='' width={28} height={28} className='rounded-md' />
          Hiker Atlas
        </a>
        <a href='/' className='tap-row text-base text-stone-800'>Home</a>
        <div className='tap-row text-base'><AccountButton /></div>
        <div className='tap-row'><OsmLink map={map} /></div>
        <a href='/terms' className='tap-row text-base text-stone-800'>Terms &amp; privacy</a>
      </nav>
    </div>}
  </>;
}
