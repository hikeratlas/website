// The frame around every page but the map's: a header (home, the map, the
// blog, signing in), the page, and a footer (terms, privacy, code, problems).
// root.tsx wraps each route in it, unless the route's handle says
// fullscreen (the map pages).
import type { ReactNode } from 'react';
import { AccountButton } from '~/components/Account';

const nav = 'text-sm font-medium text-stone-600 hover:text-green-900';

export function SiteHeader() {
  return <header className='border-b border-stone-200 bg-white'>
    <div className='mx-auto flex max-w-6xl items-center gap-4 px-4 py-3'>
      <a href='/' className='flex items-center gap-2 font-display text-lg font-extrabold text-stone-900 hover:text-green-900'>
        <img src='/favicon.svg' alt='' width={26} height={26} className='rounded-md' />
        Hiker Atlas
      </a>
      <nav className='ml-auto flex items-center gap-4'>
        <a href='/map' className={nav}>Map</a>
        <a href='/#blog' className={nav}>Blog</a>
        <AccountButton />
      </nav>
    </div>
  </header>;
}

export function SiteFooter() {
  return <footer className='mt-12 border-t border-stone-200'>
    <div className='mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-5 text-sm text-stone-500'>
      <span>Hiker Atlas, a free hobby project</span>
      <span className='ml-auto flex flex-wrap gap-x-4'>
        <a href='/terms' className='hover:text-green-900'>Terms</a>
        <a href='/terms#privacy' className='hover:text-green-900'>Privacy</a>
        <a href='https://github.com/hikeratlas' className='hover:text-green-900'>GitHub</a>
        <a href='https://github.com/hikeratlas/basemap/issues' className='hover:text-green-900'>Report a problem</a>
      </span>
    </div>
  </footer>;
}

export function SiteFrame({ children }: { children: ReactNode }) {
  return <div className='flex min-h-dvh flex-col bg-white font-sans text-stone-800'>
    <SiteHeader />
    <div className='flex-1'>{children}</div>
    <SiteFooter />
  </div>;
}
