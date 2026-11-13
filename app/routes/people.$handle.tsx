// Someone's faved hikes (/people/<handle or DID>): read from their own
// repository, on their PDS, not from anything of ours. Their faves are
// public records (com.hikeratlas.temp.fave), so anyone can see them, here or in
// any other app.
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { describeDid, isDid, resolveHandle } from '~/atproto/identity';
import { FAVE } from '~/atproto/scope';
import type { FaveSubject } from '~/atproto/faves';

interface Fave { subject: FaveSubject; createdAt: string }

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const who = (params.handle ?? '').replace(/^@/, '').toLowerCase();
  const did = isDid(who) ? who : await resolveHandle(who);
  const doc = did ? await describeDid(did) : null;
  if (!did || !doc) {
    return data({ who, handle: null as string | null, faves: [] as Fave[], error: 'No such account' }, { status: 404 });
  }
  const faves: Fave[] = [];
  let cursor: string | undefined;
  // Up to 500, newest first (the PDS pages by 100).
  for (let page = 0; page < 5; page++) {
    const u = new URL('/xrpc/com.atproto.repo.listRecords', doc.pds);
    u.searchParams.set('repo', did);
    u.searchParams.set('collection', FAVE);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u);
    if (!r.ok) break;
    const j = await r.json() as { records: { value: Partial<Fave> }[]; cursor?: string };
    for (const rec of j.records) {
      const v = rec.value;
      if (v.subject?.uri && v.subject?.title) faves.push({ subject: v.subject, createdAt: v.createdAt ?? '' });
    }
    if (!j.cursor || j.records.length < 100) break;
    cursor = j.cursor;
  }
  faves.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { who, handle: doc.handle ?? null, faves, error: null as string | null };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const name = loaderData?.handle ?? loaderData?.who ?? 'Someone';
  return [{ title: `@${name}'s faved hikes | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};

// Only links to Hiker Atlas's own pages: a record's uri is whatever its
// author wrote.
const hikeHref = (uri: string) => {
  try {
    const u = new URL(uri);
    return u.hostname === 'www.hikeratlas.com' && u.pathname.startsWith('/hikes/') ? u.pathname : null;
  } catch {
    return null;
  }
};

export default function Person() {
  const { who, handle, faves, error } = useLoaderData<typeof loader>();
  const name = handle ?? who;
  return <main className='mx-auto max-w-2xl px-4 py-6 font-sans text-stone-900'>
    <a href='/map' className='text-sm text-blue-700 hover:underline'>← Hiker Atlas</a>
    <h1 className='mt-2 font-display text-3xl font-extrabold'>@{name}</h1>
    {error
      ? <p className='mt-2 text-stone-600'>{error}.</p>
      : <>
        <p className='mt-1 text-stone-600'>
          {faves.length ? `${faves.length} faved ${faves.length === 1 ? 'hike' : 'hikes'}` : 'No faved hikes yet.'}{' '}
          Saved in {handle ? `@${handle}'s` : 'their'} own account (<code className='text-xs'>{FAVE}</code> records), so they can take them anywhere.
        </p>
        {faves.length > 0 && <ul className='mt-4 flex flex-col gap-2'>
          {faves.map((f) => {
            const href = hikeHref(f.subject.uri);
            return <li key={f.subject.key || f.subject.uri} className='rounded-xl border border-stone-200 bg-white p-3'>
              {href
                ? <a href={href} className='font-display text-lg font-bold text-stone-900 hover:underline'>{f.subject.title}</a>
                : <span className='font-display text-lg font-bold'>{f.subject.title}</span>}
              <div className='text-sm text-stone-600'>
                {[f.subject.park, f.createdAt && new Date(f.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })].filter(Boolean).join(' · ')}
              </div>
            </li>;
          })}
        </ul>}
      </>}
  </main>;
}
