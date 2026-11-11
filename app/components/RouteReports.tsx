// Pages on other sites about a curated route (hikeratlas/cc-crawler, linked
// in basemap's routes build): trip reports and trail guides that follow it,
// then, folded away, pages about its destination. Links out, with the site
// and date; nothing of the page is copied. Shared by the map's route panel
// and the server-rendered hike pages.
import type { ReportPage, RouteReports } from '~/hikes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2018-08" -> "Aug 2018"; "2018" -> "2018".
function when(date?: string): string {
  if (!date) return '';
  const [y, m] = date.split('-');
  return m && +m >= 1 && +m <= 12 ? `${MONTHS[+m - 1]} ${y}` : y;
}

function Pages({ pages }: { pages: ReportPage[] }) {
  return <ul className='mt-1.5 flex flex-col gap-1.5'>
    {pages.map((p) => <li key={p.url}>
      {/* noopener, not noreferrer: the sites see their readers came from
          Hiker Atlas (and browsers imply noopener for _blank anyway). */}
      {/* eslint-disable-next-line react/jsx-no-target-blank */}
      <a href={p.url} target='_blank' rel='noopener' className='flex flex-col gap-0.5 rounded-xl border border-stone-200 px-3 py-2.5 hover:border-stone-400 hover:bg-stone-50'>
        <span className='text-sm font-semibold text-blue-700'>{p.title || p.site}</span>
        <span className='text-xs text-stone-600'>
          {[p.site.replace(/^www\./, ''), when(p.date), p.type === 'trail_guide' ? 'trail guide' : p.type === 'trip_report' ? 'trip report' : ''].filter(Boolean).join(' · ')}
        </span>
      </a>
    </li>)}
  </ul>;
}

export default function RouteReportsList({ reports, dest }: { reports: RouteReports | null | undefined; dest?: string }) {
  const own = reports?.reports ?? [];
  const about = reports?.about ?? [];
  if (!own.length && !about.length) return null;
  return <section>
    {own.length > 0 && <>
      <h2 className='font-display text-base font-bold'>Trip reports and guides</h2>
      <Pages pages={own} />
    </>}
    {about.length > 0 && <details className='mt-2' open={!own.length}>
      <summary className='cursor-pointer text-sm text-stone-700'>{dest ? `More about ${dest}` : 'More pages'} ({about.length})</summary>
      <Pages pages={about} />
    </details>}
  </section>;
}
