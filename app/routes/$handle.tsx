// Someone's page (/@<handle or DID>): their reviews, tracks and faved
// hikes (Overview, $handle._index.tsx), and on your own page, your settings
// ($handle.settings.tsx). Read from their own repository, on their PDS, not
// from anything of ours: they're public records (com.hikeratlas.temp.*), so
// anyone can see them, here or in any other app.
//
// The route matches any one-segment path; only /@... is a person.
import { data, NavLink, Outlet, useLoaderData, useParams, useRouteLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { buildFor } from '~/build';
import { describeDid, isDid, profilePath, resolveHandle } from '~/atproto/identity';
import { listFaves, type Fave } from '~/atproto/faves';
import { getSettings, listRecords, type Rec, type ReviewRecord, type TrackRecord } from '~/atproto/posts';
import { REVIEW, TRACK } from '~/atproto/scope';
import { signOut, useAtSession } from '~/atproto/session';

// Route keys are recipe v1's (hikeratlas/route-keys: a cell part, a dot, an
// 11-character hash); faves in another form (the spike's) aren't routes.
export const isRouteKey = (k: string) => /^1[A-Za-z0-9_-]{7}[bpw][A-Za-z0-9_-]+\.[A-Za-z0-9_-]{11}$/.test(k);

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  // Any other one-segment path that no route has: not found.
  if (!(params.handle ?? '').startsWith('@')) throw data(null, { status: 404 });
  const build = buildFor(new URL(request.url)) ?? 'north-america';
  const who = (params.handle ?? '').replace(/^@/, '').toLowerCase();
  const did = isDid(who) ? who : await resolveHandle(who);
  const doc = did ? await describeDid(did) : null;
  const none = { who, did: null as string | null, pds: null as string | null, build, handle: null as string | null,
    faves: [] as Fave[], tracks: [] as Rec<TrackRecord>[], reviews: [] as Rec<ReviewRecord>[], license: null as string | null };
  if (!did || !doc) return data({ ...none, error: 'No such account' }, { status: 404 });
  const [faves, tracks, reviews, settings] = await Promise.all([
    listFaves(doc.pds, did).catch(() => [] as Fave[]),
    listRecords<TrackRecord>(doc.pds, did, TRACK).catch(() => []),
    listRecords<ReviewRecord>(doc.pds, did, REVIEW).catch(() => []),
    getSettings(doc.pds, did).catch(() => ({ license: undefined })),
  ]);
  return {
    ...none, did, pds: doc.pds, handle: doc.handle ?? null, error: null as string | null,
    faves: faves.filter((f) => isRouteKey(f.key)),
    // Only well-formed ones: these are other people's records.
    tracks: tracks.filter((t) => t.value && typeof t.value.createdAt === 'string' && t.value.gpx?.ref?.$link),
    reviews: reviews.filter((r) => r.value && typeof r.value.text === 'string' && typeof r.value.createdAt === 'string'),
    license: settings.license ?? null,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const name = loaderData?.handle ?? loaderData?.who ?? 'Someone';
  return [{ title: `@${name} | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};


// The page's data, for its tabs.
export function useProfile() {
  const d = useRouteLoaderData<typeof loader>('routes/$handle');
  if (!d) throw new Error('useProfile outside /@<handle>');
  const at = useAtSession();
  const mine = at.status === 'in' && !!d.did && at.did === d.did;
  return { ...d, name: d.handle ?? d.who, mine, session: mine && at.status === 'in' ? at.session : null };
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 pb-2 text-[15px] font-semibold ${isActive ? 'border-green-800 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`;

export default function Profile() {
  const { who, handle, did, error } = useLoaderData<typeof loader>();
  const name = handle ?? who;
  const at = useAtSession();
  const mine = at.status === 'in' && !!did && at.did === did;
  // The address as given (a handle or a DID).
  const base = profilePath(useParams().handle ?? name);
  return <main className='frame'>
    <h1>@{name}</h1>
    {mine && <p><button type='button' onClick={() => signOut()} className='text-sm text-blue-700 hover:underline'>Sign out</button></p>}
    {error
      ? <p className='mt-2 text-stone-600'>{error}.</p>
      : <>
        {/* Settings are only yours to see. */}
        {mine && <nav aria-label='Your page' className='mt-4 flex gap-5 border-b border-stone-200'>
          <NavLink to={base} end className={tab}>Overview</NavLink>
          <NavLink to={`${base}/settings`} className={tab}>Settings</NavLink>
        </nav>}
        <Outlet />
      </>}
  </main>;
}
