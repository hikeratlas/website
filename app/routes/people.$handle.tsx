// Someone's faved hikes (/people/<handle or DID>): read from their own
// repository, on their PDS, not from anything of ours. Their faves are
// public records (com.hikeratlas.temp.fave), so anyone can see them, here or in
// any other app. A fave is only a route key and when: the server lists them,
// and the browser finds which hikes they are (findRoutes).
import { useEffect, useState } from 'react';
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { buildFor } from '~/build';
import { describeDid, isDid, resolveHandle } from '~/atproto/identity';
import { listFaves, type Fave } from '~/atproto/faves';
import { findRoutes, type Found } from '~/atproto/findRoutes';

// Route keys are recipe v1's (hikeratlas/route-keys: a cell part, a dot, an
// 11-character hash); faves in another form (the spike's) aren't routes.
const isRouteKey = (k: string) => /^1[A-Za-z0-9_-]{7}[bpw][A-Za-z0-9_-]+\.[A-Za-z0-9_-]{11}$/.test(k);

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const build = buildFor(new URL(request.url)) ?? 'north-america';
  const who = (params.handle ?? '').replace(/^@/, '').toLowerCase();
  const did = isDid(who) ? who : await resolveHandle(who);
  const doc = did ? await describeDid(did) : null;
  if (!did || !doc) {
    return data({ who, did: null as string | null, build, handle: null as string | null, faves: [] as Fave[], error: 'No such account' }, { status: 404 });
  }
  const faves = (await listFaves(doc.pds, did).catch(() => [])).filter((f) => isRouteKey(f.key));
  return { who, did, build, handle: doc.handle ?? null, faves, error: null as string | null };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const name = loaderData?.handle ?? loaderData?.who ?? 'Someone';
  return [{ title: `@${name}'s saved hikes | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};

const day = (s: string) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

export default function Person() {
  const { who, build, handle, faves, error } = useLoaderData<typeof loader>();
  const name = handle ?? who;
  // Which hikes the faves are, once found: null while looking.
  const [found, setFound] = useState<Map<string, Found> | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    findRoutes(build, faves.map((f) => f.key))
      .then((m) => { if (live) setFound(m); })
      .catch(() => { if (live) setFound(new Map()); });
    return () => { live = false; };
  }, [build, faves]);
  return <main className='frame'>
    <h1>@{name}</h1>
    {error
      ? <p className='mt-2 text-stone-600'>{error}.</p>
      : <>
        <p className='mt-1 text-stone-600'>{faves.length ? `${faves.length} saved ${faves.length === 1 ? 'hike' : 'hikes'}` : 'No saved hikes yet.'}</p>
        {faves.length > 0 && <ul className='mt-4 flex flex-col gap-2'>
          {faves.map((f) => {
            const h = found?.get(f.key);
            return <li key={f.key} className='rounded-xl border border-stone-200 bg-white p-3'>
              {h
                ? h.href
                  ? <a href={h.href} className='font-display text-lg font-bold text-stone-900 hover:underline'>{h.title}</a>
                  : <span className='font-display text-lg font-bold'>{h.title}</span>
                : <span className={`font-display text-lg font-bold ${found ? 'text-stone-500' : 'text-stone-400'}`}>
                  {found ? 'A hike no longer on Hiker Atlas' : 'Finding the hike…'}
                </span>}
              <div className='text-sm text-stone-600'>{[h?.park, day(f.createdAt)].filter(Boolean).join(' · ')}</div>
            </li>;
          })}
        </ul>}
      </>}
  </main>;
}
