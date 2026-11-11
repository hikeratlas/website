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
  return <ul className='mt-0.5'>
    {pages.map((p) => <li key={p.url} className='py-0.5'>
      {/* noopener, not noreferrer: the sites see their readers came from
          Hiker Atlas (and browsers imply noopener for _blank anyway). */}
      {/* eslint-disable-next-line react/jsx-no-target-blank */}
      <a href={p.url} target='_blank' rel='noopener' className='text-blue-700 hover:underline'>{p.title || p.site}</a>
      <div className='text-gray-500 text-xs'>
        {[p.site.replace(/^www\./, ''), when(p.date), p.type === 'trail_guide' ? 'trail guide' : ''].filter(Boolean).join(' · ')}
      </div>
    </li>)}
  </ul>;
}

export default function RouteReportsList({ reports, dest }: { reports: RouteReports | null | undefined; dest?: string }) {
  const own = reports?.reports ?? [];
  const about = reports?.about ?? [];
  if (!own.length && !about.length) return null;
  return <div className='mt-2'>
    {own.length > 0 && <>
      <h3 className='font-semibold text-gray-700'>Trip reports</h3>
      <Pages pages={own} />
    </>}
    {about.length > 0 && <details className='mt-1' open={!own.length}>
      <summary className='cursor-pointer text-gray-700'>{dest ? `More about ${dest}` : 'More pages'} ({about.length})</summary>
      <Pages pages={about} />
    </details>}
  </div>;
}
