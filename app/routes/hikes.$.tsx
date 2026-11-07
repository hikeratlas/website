// /hikes, /hikes/<country>, /hikes/<country>/<state>,
// /hikes/<country>/<state>/<park>, /hikes/<country>/<state>/<park>/<hike>
// (#55, #56): the map, opened at what the path names, with the page's title,
// description, breadcrumbs and list rendered on the server, so a link
// previews and reads without the map.
import { json, redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import MapPage, { type Initial } from '~/components/MapPage';
import { buildFor } from '~/build';
import {
  type Bbox, findHike, hikeCount, hikeEntries, hikesPath, indexUrl, parkDoc, parsePath,
  regionList, regionsUrl, resolve, suggest, type Regions, type SeeAlso,
} from '~/hikes';

export { handle } from './map';

const SITE = 'https://www.hikeratlas.com';

interface Page {
  build: string | null;
  search: string;
  status: number;
  title: string;
  description: string;
  canonical: string;
  heading: string;
  crumbs: { name: string; path: string }[];
  // An index page's list, a park's hikes, or a hike's facts.
  items: { name: string; path: string; meta: string }[];
  facts: string[];
  initial: Initial;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 300 } } as RequestInit);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function boxOf(lines: [number, number][][]): Bbox | null {
  const pts = lines.flat();
  if (!pts.length) return null;
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const build = buildFor(url);
  const routesBuild = build ?? 'north-america';
  const parts = parsePath(url.pathname) ?? [];
  // Lowercase, no trailing slash: one URL per page.
  const canonicalPath = hikesPath(parts);
  if (url.pathname !== canonicalPath && params) throw redirect(`${canonicalPath}${url.search}${url.hash}`, 301);

  const page = (p: Omit<Page, 'build' | 'search' | 'canonical'>) =>
    json<Page>({ ...p, build, search: url.search, canonical: `${SITE}${hikesPath(parts)}` }, { status: p.status });

  const regions: Regions | null = await getJson(regionsUrl(routesBuild));
  if (!regions) {
    return page({
      status: 404, title: 'Hikes | Hiker Atlas', description: 'Curated hikes in parks across North America.', heading: 'Hikes',
      crumbs: [], items: [], facts: ['This map build has no hike pages yet.'], initial: { crumbs: [] },
    });
  }
  const r = resolve(regions, parts);
  const levels = [
    ...(r.country ? [{ name: r.country.name, path: hikesPath([r.country.slug]) }] : []),
    ...(r.state && r.country ? [{ name: r.state.name, path: hikesPath([r.country.slug, r.state.slug]) }] : []),
  ];
  const trail = [{ name: 'Hikes', path: '/hikes' }, ...levels];

  // Nothing by that name: suggest close ones at that level.
  if (r.missing) {
    const pool: { slug: string; name: string }[] = r.missing.level === 'country' ? regions.countries
      : r.missing.level === 'state' ? r.country!.states : r.state!.areas;
    const parent = trail[trail.length - 1];
    const base = parts.slice(0, trail.length - 1);
    const items = suggest(pool, r.missing.part).map((x) => ({ name: x.name, path: hikesPath([...base, x.slug]), meta: '' }));
    const listing = regionList(regions, r);
    return page({
      status: 404,
      title: 'Not found | Hiker Atlas',
      description: 'No hikes by that name.',
      heading: 'Not found',
      crumbs: trail,
      items: items.length ? items : listing.items,
      facts: [items.length ? `Nothing here by that name. Did you mean one of these?` : `Nothing here by that name. Here's everything in ${parent.name}.`],
      initial: {
        crumbs: trail,
        region: { heading: items.length ? 'Did you mean' : listing.heading, items: items.length ? items : listing.items },
        note: 'Nothing here by that name.',
        bbox: listing.bbox,
      },
    });
  }

  // An index page: the countries, a country's states, a state's parks.
  if (!r.area) {
    const l = regionList(regions, r);
    const where = r.state?.name ?? r.country?.name ?? 'North America';
    const total = r.state?.hikes ?? r.country?.hikes ?? regions.countries.reduce((t, c) => t + c.hikes, 0);
    return page({
      status: 200,
      title: `Hikes in ${where} | Hiker Atlas`,
      description: `${hikeCount(total)} picked in parks and trail areas across ${where}, with maps and elevation profiles.`,
      heading: l.heading,
      crumbs: trail,
      items: l.items,
      facts: [],
      initial: { crumbs: trail, region: { heading: l.heading, items: l.items }, bbox: l.bbox },
    });
  }

  // A park, or a hike in it.
  const area = r.area;
  const parkPath = hikesPath([r.country!.slug, r.state!.slug, area.slug]);
  const parkTrail = [...trail, { name: area.name, path: parkPath }];
  const index = await getJson(indexUrl(routesBuild));
  const doc = index ? await parkDoc(routesBuild, index, area.id).catch(() => null) : null;
  const entries = doc ? hikeEntries(doc) : [];
  const parkItems = entries.filter((e) => !e.slug.includes('/')).map((e) => ({
    name: e.title, path: `${parkPath}/${e.slug}`, meta: `${e.type} · ${e.km.toFixed(1)} km · ↑ ${Math.round(e.gain).toLocaleString('en-US')} m`,
  }));
  // Multi-day trips of a smaller park inside this one (hikeratlas/routes'
  // see_also: Guadalupe Mountains NP lists its Wilderness's), linked to
  // their pages in that park.
  const also = await Promise.all(((doc?.see_also ?? []) as SeeAlso[]).map(async (a) => {
    const p: string | undefined = index?.paths?.[a.park];
    const other = p ? await parkDoc(routesBuild, index, String(a.park)).catch(() => null) : null;
    const e = other ? hikeEntries(other).find((x) => x.id === a.id) : undefined;
    if (!p || !e) return null;
    return {
      name: e.title, path: hikesPath([...p.split('/'), ...e.slug.split('/')]),
      meta: `${e.type} · ${e.km.toFixed(1)} km · ↑ ${Math.round(e.gain).toLocaleString('en-US')} m · in ${a.park_name}`,
    };
  }));
  parkItems.push(...also.filter((x): x is NonNullable<typeof x> => x !== null));
  const routeBox = (id: string) => {
    const [, type, i, j] = id.split('/');
    const r = type === 'day' ? doc.day_hikes[+i]?.route
      : type === 'multi' ? doc.point_to_points[+i]?.route
      : j === undefined ? doc.base_camps[+i]?.approach : doc.base_camps[+i]?.hikes[+j]?.route;
    return r ? boxOf([r.line]) : null;
  };
  const parkBox = area.bbox;
  const parkDescription = `${hikeCount(area.hikes)} in ${area.name}, ${r.state!.name}: day hikes${doc?.point_to_points?.length ? ', multi-day routes' : ''}${doc?.base_camps?.length ? ', base camps' : ''}, with maps and elevation profiles.`;

  if (r.rest.length === 0) {
    return page({
      status: 200,
      title: `Hikes in ${area.name} | Hiker Atlas`,
      description: parkDescription,
      heading: `Hikes in ${area.name}`,
      crumbs: parkTrail,
      items: parkItems,
      facts: [],
      initial: { crumbs: parkTrail, focus: { id: area.id, name: area.name, at: 0 }, bbox: parkBox },
    });
  }

  const want = r.rest.join('/');
  const found = findHike(entries, want);
  // A close match (a renamed hike): its own URL.
  if (found && !found.exact) throw redirect(`${parkPath}/${found.entry.slug}${url.search}`, 302);
  if (!found) {
    return page({
      status: 404,
      title: `Hikes in ${area.name} | Hiker Atlas`,
      description: parkDescription,
      heading: `Hikes in ${area.name}`,
      crumbs: parkTrail,
      items: parkItems,
      facts: ['That hike has changed since the link was made. Here are the hikes in the park.'],
      initial: {
        crumbs: parkTrail, focus: { id: area.id, name: area.name, at: 0 }, bbox: parkBox,
        note: 'That hike has changed since the link was made. Here are the hikes in the park.',
      },
    });
  }
  const e = found.entry;
  const hikeTrail = [...parkTrail];
  if (e.slug.includes('/')) {
    const camp = entries.find((x) => x.slug === e.slug.split('/')[0]);
    if (camp) hikeTrail.push({ name: camp.title, path: `${parkPath}/${camp.slug}` });
  }
  hikeTrail.push({ name: e.title, path: `${parkPath}/${e.slug}` });
  const kind = e.type === 'Multi-day' ? 'multi-day hike' : e.type === 'Base camp' ? 'walk to a base camp' : 'day hike';
  const stats = `${e.km.toFixed(e.km < 10 ? 1 : 0)} km · ↑ ${Math.round(e.gain).toLocaleString('en-US')} m`;
  return page({
    status: 200,
    title: `${e.title}: ${e.km.toFixed(0)} km ${kind}, ${area.name} | Hiker Atlas`,
    description: `${e.title}: ${/^[aeio8]|^1[18]\b/i.test(e.km.toFixed(1)) ? 'an' : 'a'} ${e.km.toFixed(1)} km ${kind} with ${Math.round(e.gain).toLocaleString('en-US')} m of climbing in ${area.name}, ${r.state!.name}. Map, elevation profile and stops.`,
    heading: e.title,
    crumbs: hikeTrail,
    items: [],
    facts: [`${e.type} · ${stats}`, `In ${area.name}, ${r.state!.name}`],
    initial: { crumbs: hikeTrail, focus: { id: area.id, name: area.name, at: 0, route: e.id }, bbox: routeBox(e.id) ?? parkBox },
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Hiker Atlas' }];
  return [
    { title: data.title },
    { name: 'description', content: data.description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    { property: 'og:title', content: data.title.replace(/ \| Hiker Atlas$/, '') },
    { property: 'og:description', content: data.description },
    { property: 'og:url', content: data.canonical },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Hiker Atlas' },
    ...(data.status === 404 ? [{ name: 'robots', content: 'noindex' }] : []),
    ...(data.crumbs.length ? [{
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: data.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${SITE}${c.path}` })),
      },
    }] : []),
  ];
};

export default function Hikes() {
  const data = useLoaderData<typeof loader>();
  const href = (path: string) => `${path}${data.search}`;
  // The page's content, shown until the map is ready (and to anything that
  // doesn't run the map): breadcrumbs, heading, facts and list, as links.
  const summary = <article
    className='absolute right-3 bottom-8 bg-white/95 rounded shadow p-3 text-sm overflow-y-auto'
    style={{ zIndex: 2, width: 'min(480px, calc(100% - 24px))', maxHeight: 'calc(100% - 48px)' }}
  >
    {data.crumbs.length > 0 && <nav aria-label='Breadcrumb' className='text-xs text-gray-600 mb-0.5'>
      <ol className='flex flex-wrap gap-x-1'>
        {data.crumbs.map((c, i) => <li key={c.path} className='flex gap-x-1'>
          {i > 0 && <span aria-hidden='true'>›</span>}
          {i < data.crumbs.length - 1 ? <a href={href(c.path)} className='text-blue-700 hover:underline'>{c.name}</a> : <span aria-current='page'>{c.name}</span>}
        </li>)}
      </ol>
    </nav>}
    <h1 className='font-semibold text-base'>{data.heading}</h1>
    {data.facts.map((f) => <p key={f} className='text-gray-600'>{f}</p>)}
    {data.items.length > 0 && <ul className='mt-1'>
      {data.items.map((c) => <li key={c.path} className='py-0.5'>
        <a href={href(c.path)} className='text-blue-700 hover:underline'>{c.name}</a>
        {c.meta && <div className='text-gray-500 text-xs'>{c.meta}</div>}
      </li>)}
    </ul>}
  </article>;
  return <MapPage build={data.build} search={data.search} initial={data.initial} summary={summary} />;
}
