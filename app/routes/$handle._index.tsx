// Someone's page, its Overview tab (/@<handle>): their reviews and tracks,
// newest hike first, and their faved hikes. Each is tied to a hike by its
// route key, and the browser finds which hikes they are (findRoutes). On
// your own page, you can delete your posts.
import { useEffect, useMemo, useState } from 'react';
import { useRevalidator } from 'react-router';
import { lines, readBlob } from '~/atproto/gpx';
import { blobUrl, deletePost, tagLabel, type Photo, type Rec, type ReviewRecord, type TrackRecord } from '~/atproto/posts';
import { findRoutes, type Found } from '~/atproto/findRoutes';
import { durationText, kmText, LICENSE_LABEL } from '~/components/PostDialog';
import { isRouteKey, useProfile } from './$handle';

const day = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// One entry in someone's list: a review (with its track, if it has one),
// or a track on its own.
interface Post { at: string; review?: Rec<ReviewRecord>; track?: Rec<TrackRecord> }

export default function Overview() {
  const { did, pds, build, faves, tracks, reviews, session, mine } = useProfile();
  const revalidator = useRevalidator();

  const posts = useMemo(() => {
    const byUri = new Map(tracks.map((t) => [t.uri, t]));
    const used = new Set<string>();
    const out: Post[] = reviews.map((r) => {
      const track = r.value.track?.uri ? byUri.get(r.value.track.uri) : undefined;
      if (track) used.add(track.uri);
      return { at: r.value.hikedAt ?? track?.value.startedAt ?? r.value.createdAt, review: r, track };
    });
    for (const t of tracks) if (!used.has(t.uri)) out.push({ at: t.value.startedAt ?? t.value.createdAt, track: t });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [tracks, reviews]);

  // Which hikes they're of, once found: null while looking.
  const keys = useMemo(() => [...new Set([
    ...faves.map((f) => f.key),
    ...posts.map((p) => p.review?.value.routeKey ?? p.track?.value.routeKey).filter((k): k is string => !!k && isRouteKey(k)),
  ])], [faves, posts]);
  const [found, setFound] = useState<Map<string, Found> | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    findRoutes(build, keys)
      .then((m) => { if (live) setFound(m); })
      .catch(() => { if (live) setFound(new Map()); });
    return () => { live = false; };
  }, [build, keys]);

  const remove = async (p: Post) => {
    if (!session) return;
    const what = p.review && p.track ? 'this review and its track' : p.review ? 'this review' : 'this track';
    if (!window.confirm(`Delete ${what}? Copies others already made may remain.`)) return;
    try {
      if (p.review) await deletePost(session, p.review.uri);
      if (p.track) await deletePost(session, p.track.uri);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
    revalidator.revalidate();
  };

  const hikeTitle = (key?: string) => {
    const h = key ? found?.get(key) : undefined;
    if (h) return h.href
      ? <a href={h.href} className='font-display text-lg font-bold text-stone-900 hover:underline'>{h.title}</a>
      : <span className='font-display text-lg font-bold'>{h.title}</span>;
    return <span className={`font-display text-lg font-bold ${found ? 'text-stone-500' : 'text-stone-400'}`}>
      {!key ? 'A hike' : found ? 'A hike no longer on Hiker Atlas' : 'Finding the hike…'}
    </span>;
  };

  return <>
        <h2>Hikes</h2>
        <p className='mt-1 text-stone-600'>{posts.length
          ? `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`
          : mine ? 'Nothing posted yet. Open a hike and choose Post to add a review or your track.' : 'Nothing posted yet.'}</p>
        {posts.length > 0 && <ul className='mt-4 flex flex-col gap-3'>
          {posts.map((p) => {
            const key = p.review?.value.routeKey ?? p.track?.value.routeKey;
            const h = key ? found?.get(key) : undefined;
            const t = p.track?.value;
            const lic = p.review?.value.license ?? t?.license;
            const photos = [...(p.review?.value.photos ?? []), ...(t?.photos ?? [])];
            return <li key={p.review?.uri ?? p.track!.uri} className='flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3'>
              <div>
                {hikeTitle(key)}
                <div className='text-sm text-stone-600'>{[h?.park, day(p.at)].filter(Boolean).join(' · ')}</div>
              </div>
              {p.review?.value.tags?.length ? <div className='flex flex-wrap gap-1.5'>
                {p.review.value.tags.slice(0, 10).map((g) => <span key={g} className='rounded-full bg-green-50 px-2.5 py-0.5 text-[13px] text-green-900'>{tagLabel(g)}</span>)}
              </div> : null}
              {p.review && <p className='whitespace-pre-line text-[15px] text-stone-800'>{p.review.value.text.slice(0, 3000)}</p>}
              {photos.length > 0 && pds && did && <Photos photos={photos} pds={pds} did={did} />}
              {t && pds && did && <TrackView track={t} pds={pds} did={did} />}
              <div className='flex items-center justify-between gap-2 text-xs text-stone-500'>
                <span>Shared under {LICENSE_LABEL[lic ?? 'hikeratlas-only'] ?? lic}{lic ? '' : ' (no licence given)'}</span>
                {session && <button type='button' onClick={() => remove(p)} className='text-red-700 hover:underline'>Delete</button>}
              </div>
            </li>;
          })}
        </ul>}

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


function Photos({ photos, pds, did }: { photos: Photo[]; pds: string; did: string }) {
  return <div className='grid grid-cols-3 gap-1.5 sm:grid-cols-4'>
    {photos.filter((ph) => ph?.image?.ref?.$link).slice(0, 70).map((ph) => {
      const url = blobUrl(pds, did, ph.image);
      return <a key={ph.image.ref.$link} href={url} target='_blank' rel='noreferrer' className='block aspect-square overflow-hidden rounded-lg bg-stone-100'>
        {/* !h-full: .frame img is h-auto */}
        <img src={url} alt={ph.alt ?? ''} loading='lazy' className='!h-full w-full object-cover' />
      </a>;
    })}
  </div>;
}

// A track's stats, its line (drawn from its GPX, fetched when shown), and
// its GPX to download.
function TrackView({ track, pds, did }: { track: TrackRecord; pds: string; did: string }) {
  const url = blobUrl(pds, did, track.gpx);
  const [segs, setSegs] = useState<[number, number][][] | null>(null);
  const [gpxText, setGpxText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url).then(async (r) => {
      if (!r.ok) return;
      const text = await readBlob(new Uint8Array(await r.arrayBuffer()), track.gpx.mimeType);
      if (!live) return;
      setGpxText(text);
      setSegs(lines(text));
    }).catch(() => {});
    return () => { live = false; };
  }, [url, track.gpx.mimeType]);
  const facts = [
    typeof track.distance === 'number' && kmText(track.distance),
    typeof track.gain === 'number' && `↑ ${track.gain.toLocaleString('en-US')} m`,
    typeof track.duration === 'number' && durationText(track.duration),
  ].filter(Boolean).join(' · ');
  const download = () => {
    if (!gpxText) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpxText], { type: 'application/gpx+xml' }));
    a.download = `${(track.title ?? 'track').replace(/[^\w-]+/g, '-')}.gpx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return <div className='flex items-center gap-3 rounded-lg bg-stone-50 p-2'>
    <TrackLine segs={segs} />
    <div className='flex min-w-0 flex-1 flex-col text-sm'>
      <span className='font-semibold'>GPX track</span>
      {facts && <span className='text-stone-700'>{facts}</span>}
      <button type='button' onClick={download} disabled={!gpxText} className='self-start text-blue-700 hover:underline disabled:text-stone-400'>Download GPX</button>
    </div>
  </div>;
}

function TrackLine({ segs }: { segs: [number, number][][] | null }) {
  const size = 72;
  if (!segs?.length) return <div className='h-[72px] w-[72px] shrink-0 rounded bg-stone-200' />;
  const pts = segs.flat();
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1e-6, pad = 6, s = (size - 2 * pad) / span;
  const ox = pad + ((size - 2 * pad) - (x1 - x0) * s) / 2, oy = pad + ((size - 2 * pad) - (y1 - y0) * s) / 2;
  const d = segs.map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[0] * k - x0) * s).toFixed(1)},${(oy + (y1 - p[1]) * s).toFixed(1)}`).join('')).join('');
  return <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className='shrink-0 rounded bg-white' aria-hidden='true'>
    <path d={d} fill='none' stroke='#c026d3' strokeWidth='2' strokeLinejoin='round' strokeLinecap='round' />
  </svg>;
}
