// What other hikers have posted about a route, from the indexer
// (hikeratlas/atproto-indexer, by its route key): a line of counts near the
// top of a hike's sheet, and "From hikers", their reviews and tracks. Each
// post links to its author's profile and to a report form. Without the
// indexer, both render nothing.
//
// A review shows its track (website#158): drawn in the review on a wide
// screen; on a phone, where the sheet is tight, a "Has a track" line that
// takes you to it in Tracks.
import { useEffect, useState } from 'react';
import { describeDid } from '~/atproto/identity';
import { type ActorView, type PostView, type RouteStats, getRouteReviews, getRouteStats, getRouteTracks, reportUrl, useFresh } from '~/atproto/indexer';
import { getRecordByUri, tagLabel, type ReviewRecord, type TrackRecord } from '~/atproto/posts';
import { addNew, findTrack, isTrack, parseAtUri } from '~/atproto/postLists';
import { LICENSE_LABEL } from '~/components/PostDialog';
import { Photos, TrackView, day } from '~/components/Posts';

const FIRST = 3; // posts shown before "More"
const PAGE = 10;

export function useRouteStats(key: string | null): RouteStats | null {
  const [stats, setStats] = useState<RouteStats | null>(null);
  // After one of our writes to this route: refetch, past the cache.
  const fresh = useFresh(key);
  useEffect(() => {
    if (!fresh) setStats(null);
    if (!key) return;
    let live = true;
    getRouteStats([key], fresh).then((m) => { if (live && m) setStats(m.get(key) ?? null); });
    return () => { live = false; };
  }, [key, fresh]);
  return stats;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "♥ 12 faves · 3 reviews · 2 tracks"; nothing until someone has posted.
export function RouteCounts({ stats }: { stats: RouteStats | null }) {
  if (!stats || !(stats.faves || stats.reviews || stats.tracks)) return null;
  const parts = [
    stats.faves > 0 && plural(stats.faves, 'fave'),
    stats.reviews > 0 && <a key='r' href='#from-hikers' className='hover:underline'>{plural(stats.reviews, 'review')}</a>,
    stats.tracks > 0 && <a key='t' href='#from-hikers' className='hover:underline'>{plural(stats.tracks, 'track')}</a>,
  ].filter(Boolean);
  return <div className='-mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-stone-700'>
    <svg viewBox='0 0 24 24' className='h-3.5 w-3.5 text-rose-600' fill='currentColor' aria-hidden='true'>
      <path d='M12 20.5s-7.5-4.4-9.3-9.2C1.4 7.7 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.2 4.3 6.8-1.8 4.8-9.3 9.2-9.3 9.2z' />
    </svg>
    {parts.map((p, i) => <span key={i}>{i > 0 && <span className='mr-1.5 text-stone-400'>·</span>}{p}</span>)}
  </div>;
}

// An author's PDS: from the indexer, else their DID document.
function usePds(author: ActorView): string | null {
  const [pds, setPds] = useState<string | null>(author.pds || null);
  useEffect(() => {
    if (author.pds) { setPds(author.pds); return; }
    let live = true;
    describeDid(author.did).then((d) => { if (live) setPds(d?.pds ?? null); });
    return () => { live = false; };
  }, [author.did, author.pds]);
  return pds;
}

function Author({ author }: { author: ActorView }) {
  return author.handle
    ? <a href={`/@${author.handle}`} className='font-semibold text-stone-900 hover:underline'>@{author.handle}</a>
    : <span className='font-semibold text-stone-700' title={author.did}>{author.did.slice(0, 16)}…</span>;
}

function Footer({ uri, license }: { uri: string; license?: string }) {
  return <div className='flex items-center justify-between gap-2 text-xs text-stone-500'>
    <span>{LICENSE_LABEL[license ?? 'hikeratlas-only'] ?? license}</span>
    <a href={reportUrl(uri)} target='_blank' rel='noreferrer' className='hover:underline'>Report</a>
  </div>;
}

// A track's element id in Tracks, for a review's "Has a track" to go to.
const trackId = (uri: string) => `track-${uri.replace(/[^\w-]+/g, '-')}`;

// A review's track: from the loaded Tracks if it's there, else from the
// author's PDS by the review's strongRef. Null if it has none, or it's gone
// or unreadable.
function useReviewTrack(post: PostView<ReviewRecord>, pds: string | null, loaded: PostView<TrackRecord>[]): PostView<TrackRecord> | null {
  const uri = typeof post.record.track?.uri === 'string' ? post.record.track.uri : undefined;
  const hit = findTrack(uri, loaded) ?? null;
  const inLoaded = !!hit;
  const [fetched, setFetched] = useState<PostView<TrackRecord> | null>(null);
  useEffect(() => {
    setFetched(null);
    if (inLoaded || !uri || !pds) return;
    let live = true;
    getRecordByUri(pds, uri).then((rec) => {
      if (live && rec && isTrack(rec.value)) setFetched({ uri: rec.uri, cid: rec.cid, author: post.author, record: rec.value, indexedAt: '' });
    });
    return () => { live = false; };
  }, [uri, pds, inLoaded, post.author]);
  return hit ?? fetched;
}

function Review({ post, phone, tracks, showTrack }: {
  post: PostView<ReviewRecord>; phone: boolean; tracks: PostView<TrackRecord>[]; showTrack: (t: PostView<TrackRecord>) => void;
}) {
  const pds = usePds(post.author);
  const r = post.record;
  const track = useReviewTrack(post, pds, tracks);
  // Its blobs are in the repository the record is in.
  const trackDid = track ? parseAtUri(track.uri)?.repo ?? post.author.did : null;
  return <li className='flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3'>
    <div className='text-sm text-stone-600'><Author author={post.author} />{` · ${day(r.hikedAt ?? r.createdAt)}`}</div>
    {r.tags?.length ? <div className='flex flex-wrap gap-1.5'>
      {r.tags.slice(0, 10).map((g) => <span key={g} className='rounded-full bg-green-50 px-2.5 py-0.5 text-[13px] text-green-900'>{tagLabel(g)}</span>)}
    </div> : null}
    <p className='whitespace-pre-line text-[15px] text-stone-800'>{String(r.text ?? '').slice(0, 3000)}</p>
    {r.photos?.length && pds ? <Photos photos={r.photos} pds={pds} did={post.author.did} credit={{ did: post.author.did, handle: post.author.handle, license: r.license }} /> : null}
    {track && pds && trackDid && (phone
      // Not a #hash link: the map keeps its position in the hash.
      ? <a href={`#${trackId(track.uri)}`} onClick={(e) => { e.preventDefault(); showTrack(track); }}
        className='self-start text-sm text-blue-700 hover:underline'>Has a track</a>
      : <TrackView track={track.record} pds={pds} did={trackDid} />)}
    <Footer uri={post.uri} license={r.license} />
  </li>;
}

function Track({ post }: { post: PostView<TrackRecord> }) {
  const pds = usePds(post.author);
  const t = post.record;
  return <li id={trackId(post.uri)} className='flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3'>
    <div className='text-sm text-stone-600'><Author author={post.author} />{` · ${day(t.startedAt ?? t.createdAt)}`}{t.title ? ` · ${t.title}` : ''}</div>
    {pds && <TrackView track={t} pds={pds} did={post.author.did} />}
    {t.photos?.length && pds ? <Photos photos={t.photos} pds={pds} did={post.author.did} credit={{ did: post.author.did, handle: post.author.handle, license: t.license }} /> : null}
    <Footer uri={post.uri} license={t.license} />
  </li>;
}

// A list that shows FIRST posts, then pages through the rest.
function usePosts<T extends { uri: string }>(key: string, count: number, load: (key: string, limit: number, cursor?: string, fresh?: number) => Promise<{ items: T[]; cursor?: string } | null>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fresh = useFresh(key);
  useEffect(() => {
    if (!count) { setItems([]); setCursor(undefined); return; }
    let live = true;
    load(key, FIRST, undefined, fresh).then((r) => { if (live && r) { setItems(r.items); setCursor(r.cursor); } });
    return () => { live = false; };
  }, [key, count, load, fresh]);
  const more = async () => {
    setBusy(true);
    const r = await load(key, PAGE, cursor);
    if (r) { setItems((xs) => addNew(xs, r.items)); setCursor(r.cursor); }
    setBusy(false);
  };
  // One added out of turn: a review's track that isn't on the pages loaded.
  const add = (x: T) => setItems((xs) => addNew(xs, [x]));
  return { items, more: cursor ? more : null, busy, add };
}

const loadReviews = async (key: string, limit: number, cursor?: string, fresh = 0) => {
  const r = await getRouteReviews(key, limit, cursor, fresh);
  return r && { items: r.reviews, cursor: r.cursor };
};
const loadTracks = async (key: string, limit: number, cursor?: string, fresh = 0) => {
  const r = await getRouteTracks(key, limit, cursor, fresh);
  return r && { items: r.tracks, cursor: r.cursor };
};

function More({ more, busy, what }: { more: (() => void) | null; busy: boolean; what: string }) {
  if (!more) return null;
  return <button type='button' onClick={more} disabled={busy} className='self-start text-sm text-blue-700 hover:underline disabled:text-stone-400'>
    {busy ? 'Loading…' : `More ${what}`}
  </button>;
}

// phone: the sheet is a phone's bottom sheet (CuratedRoutes' useIsPhone),
// too tight to draw a review's track in it.
export function FromHikers({ routeKey, stats, phone }: { routeKey: string; stats: RouteStats | null; phone: boolean }) {
  const reviews = usePosts(routeKey, stats?.reviews ?? 0, loadReviews);
  const tracks = usePosts(routeKey, stats?.tracks ?? 0, loadTracks);
  // A "Has a track" tapped: its track, to scroll to once it's in Tracks.
  const [goTo, setGoTo] = useState<string | null>(null);
  useEffect(() => {
    if (!goTo) return;
    document.getElementById(trackId(goTo))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setGoTo(null);
  }, [goTo, tracks.items]);
  const showTrack = (t: PostView<TrackRecord>) => { tracks.add(t); setGoTo(t.uri); };
  if (!reviews.items.length && !tracks.items.length) return null;
  return <section id='from-hikers' className='flex flex-col gap-2'>
    <h2 className='font-display text-base font-bold'>From hikers</h2>
    {stats?.recentTags?.length ? <div className='text-[13px] text-stone-700'>
      Reported in the last month: {stats.recentTags.slice(0, 6).map(tagLabel).join(', ')}
    </div> : null}
    {reviews.items.length > 0 && <ul className='flex flex-col gap-2'>{reviews.items.map((p) =>
      <Review key={p.uri} post={p} phone={phone} tracks={tracks.items} showTrack={showTrack} />)}</ul>}
    <More more={reviews.more} busy={reviews.busy} what='reviews' />
    {tracks.items.length > 0 && <>
      <h3 className='mt-1 text-sm font-semibold text-stone-700'>Tracks</h3>
      <ul className='flex flex-col gap-2'>{tracks.items.map((p) => <Track key={p.uri} post={p} />)}</ul>
    </>}
    <More more={tracks.more} busy={tracks.busy} what='tracks' />
  </section>;
}
