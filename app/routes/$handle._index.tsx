// Someone's page, its Overview tab (/@<handle>): their reviews and their
// tracks, each newest hike first, and their faved hikes. Every track is
// listed, posted alone or with a review, and a review shows its track too
// (website#158). Each is tied to a hike by its route key, and the browser
// finds which hikes they are (findRoutes). On your own page, you can delete
// your posts (a review and its track go together), and edit your reviews.
import { useEffect, useMemo, useState } from 'react';
import { useRevalidator } from 'react-router';
import { deletePost, tagLabel, type Rec, type ReviewRecord, type TrackRecord } from '~/atproto/posts';
import { deleteTargets, profileLists } from '~/atproto/postLists';
import { findRoutes, type Found } from '~/atproto/findRoutes';
import { LICENSE_LABEL } from '~/components/PostDialog';
import { EditReviewDialog } from '~/components/EditReview';
import { Photos, TrackView, day } from '~/components/Posts';
import { isRouteKey, useProfile } from './$handle';

export default function Overview() {
  const { did, pds, build, faves, tracks, reviews, session, mine, handle } = useProfile();
  const revalidator = useRevalidator();

  const lists = useMemo(() => profileLists(reviews, tracks), [reviews, tracks]);
  const [editing, setEditing] = useState<Rec<ReviewRecord> | null>(null);

  // Which hikes they're of, once found: null while looking.
  const keys = useMemo(() => [...new Set([
    ...faves.map((f) => f.key),
    ...[...reviews, ...tracks].map((p) => p.value.routeKey).filter((k): k is string => !!k && isRouteKey(k)),
  ])], [faves, reviews, tracks]);
  const [found, setFound] = useState<Map<string, Found> | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    findRoutes(build, keys)
      .then((m) => { if (live) setFound(m); })
      .catch(() => { if (live) setFound(new Map()); });
    return () => { live = false; };
  }, [build, keys]);

  const remove = async (what: { review: Rec<ReviewRecord> } | { track: Rec<TrackRecord> }) => {
    if (!session) return;
    const { uris, confirm } = deleteTargets(what, reviews, session.did);
    if (!window.confirm(confirm)) return;
    try {
      for (const uri of uris) await deletePost(session, uri);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
    revalidator.revalidate();
  };

  // A post's title: its curated hike's; without one, its track's own title
  // (a review's, its track's), as the track was named when posted.
  const hikeTitle = (key?: string, own?: string) => {
    if (!key && own?.trim()) return <span className='font-display text-lg font-bold'>{own}</span>;
    const h = key ? found?.get(key) : undefined;
    if (h) return h.href
      ? <a href={h.href} className='font-display text-lg font-bold text-stone-900 hover:underline'>{h.title}</a>
      : <span className='font-display text-lg font-bold'>{h.title}</span>;
    return <span className={`font-display text-lg font-bold ${found ? 'text-stone-500' : 'text-stone-400'}`}>
      {!key ? 'A hike' : found ? 'A hike no longer on Hiker Atlas' : 'Finding the hike…'}
    </span>;
  };

  const heading = (key: string | undefined, at: string, own?: string) => <div>
    {hikeTitle(key, own)}
    <div className='text-sm text-stone-600'>{[key ? found?.get(key)?.park : undefined, day(at)].filter(Boolean).join(' · ')}</div>
  </div>;

  const footer = (lic: string | undefined, what: Parameters<typeof remove>[0]) =>
    <div className='flex items-center justify-between gap-2 text-xs text-stone-500'>
      <span>Shared under {LICENSE_LABEL[lic ?? 'hikeratlas-only'] ?? lic}{lic ? '' : ' (no licence given)'}</span>
      {session && <span className='flex gap-3'>
        {'review' in what && pds && <button type='button' onClick={() => setEditing(what.review)} className='text-blue-700 hover:underline'>Edit</button>}
        <button type='button' onClick={() => remove(what)} className='text-red-700 hover:underline'>Delete</button>
      </span>}
    </div>;

  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

  return <>
        <h2>Reviews</h2>
        <p className='mt-1 text-stone-600'>{lists.reviews.length
          ? count(lists.reviews.length, 'review')
          : mine && !lists.tracks.length ? 'Nothing posted yet. Open a hike and choose Post to add a review or your track.' : 'No reviews yet.'}</p>
        {lists.reviews.length > 0 && <ul className='mt-4 flex flex-col gap-3'>
          {lists.reviews.map(({ at, review, track }) => {
            const r = review.value;
            return <li key={review.uri} className='flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3'>
              {heading(r.routeKey ?? track?.value.routeKey, at, track?.value.title)}
              {r.tags?.length ? <div className='flex flex-wrap gap-1.5'>
                {r.tags.slice(0, 10).map((g) => <span key={g} className='rounded-full bg-green-50 px-2.5 py-0.5 text-[13px] text-green-900'>{tagLabel(g)}</span>)}
              </div> : null}
              <p className='whitespace-pre-line text-[15px] text-stone-800'>{r.text.slice(0, 3000)}</p>
              {r.photos?.length && pds && did ? <Photos photos={r.photos} pds={pds} did={did} credit={{ did, handle, license: r.license }} /> : null}
              {/* Its track is in Tracks too, with its photos; here, its line and stats. */}
              {track && pds && did && <TrackView track={track.value} pds={pds} did={did} />}
              {footer(r.license, { review })}
            </li>;
          })}
        </ul>}

        <h2>Tracks</h2>
        <p className='mt-1 text-stone-600'>{lists.tracks.length ? count(lists.tracks.length, 'track') : 'No tracks yet.'}</p>
        {lists.tracks.length > 0 && <ul className='mt-4 flex flex-col gap-3'>
          {lists.tracks.map(({ at, track }) => {
            const t = track.value;
            return <li key={track.uri} className='flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3'>
              {heading(t.routeKey, at, t.title)}
              {pds && did && <TrackView track={t} pds={pds} did={did} />}
              {t.photos?.length && pds && did ? <Photos photos={t.photos} pds={pds} did={did} credit={{ did, handle, license: t.license }} /> : null}
              {footer(t.license, { track })}
            </li>;
          })}
        </ul>}

        {editing && session && pds && <EditReviewDialog review={editing} session={session} pds={pds}
          onClose={() => setEditing(null)} onSaved={() => revalidator.revalidate()} />}

        <h2>Faved hikes</h2>
        <p className='mt-1 text-stone-600'>{faves.length ? `${faves.length} faved ${faves.length === 1 ? 'hike' : 'hikes'}` : 'No faved hikes yet.'}</p>
        {faves.length > 0 && <ul className='mt-4 flex flex-col gap-2'>
          {faves.map((f) => {
            const h = found?.get(f.key);
            return <li key={f.key} className='rounded-xl border border-stone-200 bg-white p-3'>
              {hikeTitle(f.key)}
              <div className='text-sm text-stone-600'>{[h?.park, day(f.createdAt)].filter(Boolean).join(' · ')}</div>
            </li>;
          })}
        </ul>}

  </>;
}
