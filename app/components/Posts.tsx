// Pieces of posts (reviews and tracks), shared by profile pages and hike
// pages' "From hikers": photos, and a track's stats, line and GPX.
import { useEffect, useRef, useState } from 'react';
import { lines, readBlob } from '~/atproto/gpx';
import { photoUrl } from '~/atproto/indexer';
import { blobUrl, type Photo, type TrackRecord } from '~/atproto/posts';
import { stepsText } from '~/atproto/postLists';
import { durationText, kmText, LICENSE_LABEL } from '~/components/PostDialog';
import { elevation, useUnits } from '~/units';

export const day = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// A photo's thumbnail, through the indexer's cache (website#177): at most
// 640 px a side, where the photo itself is up to 2 MB. If the indexer can't
// give it (a record it hasn't indexed yet, or no thumbnails there), the photo
// from its author's PDS instead. Lazy, so photos out of view wait.
export function PhotoImg({ photo, pds, did, alt, className }: { photo: Photo; pds: string; did: string; alt?: string; className?: string }) {
  const [fallback, setFallback] = useState(false);
  const size = photo.aspectRatio;
  return <img src={fallback ? blobUrl(pds, did, photo.image) : photoUrl(did, photo.image.ref.$link)}
    onError={() => setFallback(true)} alt={alt ?? photo.alt ?? ''} loading='lazy' decoding='async'
    {...(size ? { width: size.width, height: size.height } : {})} className={className} />;
}

// Who posted a set of photos, and under what licence: shown in the viewer.
export interface PhotoCredit { did: string; handle?: string | null; license?: string }

// A post's photos as tiles. A tile opens the viewer (PhotoViewer), the same
// from a hike's "From hikers" and from a profile page.
export function Photos({ photos, pds, did, credit }: { photos: Photo[]; pds: string; did: string; credit: PhotoCredit }) {
  const shown = photos.filter((ph) => ph?.image?.ref?.$link).slice(0, 70);
  const [open, setOpen] = useState<number | null>(null);
  return <>
    <div className='grid grid-cols-3 gap-1.5 sm:grid-cols-4'>
      {shown.map((ph, i) =>
        <button type='button' key={ph.image.ref.$link} onClick={() => setOpen(i)}
          aria-label={ph.alt ? `Open photo: ${ph.alt}` : `Open photo ${i + 1} of ${shown.length}`}
          className='block aspect-square cursor-zoom-in overflow-hidden rounded-lg bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600'>
          {/* !h-full: .frame img is h-auto */}
          <PhotoImg photo={ph} pds={pds} did={did} className='!h-full w-full object-cover' />
        </button>)}
    </div>
    {open !== null && <PhotoViewer photos={shown} start={open} pds={pds} did={did} credit={credit} onClose={() => setOpen(null)} />}
  </>;
}

// A photo as uploaded, through the indexer (inline, where the PDS's blob
// downloads), else from the PDS. The thumbnail, already loaded for its tile,
// shows until it arrives.
function FullPhoto({ photo, pds, did }: { photo: Photo; pds: string; did: string }) {
  const cid = photo.image.ref.$link;
  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFallback(false); setLoaded(false); }, [cid]);
  const r = photo.aspectRatio;
  // Fits the space left by the caption and buttons, at the photo's own shape.
  const box = 'max-h-[calc(100dvh-9rem)] max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-8rem)] object-contain';
  return <div className='relative grid place-items-center' style={r ? { aspectRatio: `${r.width} / ${r.height}` } : undefined}>
    {!loaded && <PhotoImg photo={photo} pds={pds} did={did} alt='' className={`${box} col-start-1 row-start-1 h-auto w-auto blur-[1px]`} />}
    <img key={cid} src={fallback ? blobUrl(pds, did, photo.image) : photoUrl(did, cid, 'fullsize')} alt={photo.alt ?? ''}
      onLoad={() => setLoaded(true)} onError={() => { if (!fallback) setFallback(true); }} decoding='async'
      {...(r ? { width: r.width, height: r.height } : {})}
      className={`${box} col-start-1 row-start-1 h-auto w-auto ${loaded ? '' : 'invisible'}`} />
  </div>;
}

// The photo viewer: one photo at a time, large, with its caption, who posted
// it and its licence. Previous and next by the buttons, the arrow keys or a
// swipe; closed by Esc, the X, or a click beside the photo.
export function PhotoViewer({ photos, start, pds, did, credit, onClose }: {
  photos: Photo[]; start: number; pds: string; did: string; credit: PhotoCredit; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(start);
  const n = photos.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  // showModal focuses the first control, the X; Esc closes (onClose).
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setI((x) => (x + 1) % n); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setI((x) => (x - 1 + n) % n); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [n]);
  // The next and previous photos, fetched ahead.
  useEffect(() => {
    if (n < 2) return;
    for (const d of [1, -1]) new Image().src = photoUrl(did, photos[(i + d + n) % n].image.ref.$link, 'fullsize');
  }, [i, n, did, photos]);
  const touch = useRef<number | null>(null);
  const photo = photos[i];
  const lic = credit.license ?? 'hikeratlas-only';
  const btn = 'tap grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  // Clicks and swipes have keyboard equivalents: Esc, the arrow keys.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
  return <dialog ref={dialog} onClose={onClose} aria-label='Photo'
    // A click on the backdrop or beside the photo (not on it, or a control) closes.
    onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop) dialog.current?.close(); }}
    onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={(e) => {
      if (touch.current === null) return;
      const dx = e.changedTouches[0].clientX - touch.current;
      touch.current = null;
      if (n > 1 && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    }}
    className='m-0 h-dvh max-h-none w-screen max-w-none bg-stone-950 p-0 text-white backdrop:bg-stone-950'>
    <div data-backdrop='1' className='flex h-full flex-col'>
      <div data-backdrop='1' className='flex items-center justify-between gap-2 p-2'>
        <span className='px-2 text-sm text-white/80' aria-live='polite'>{n > 1 ? `${i + 1} / ${n}` : ''}</span>
        <button type='button' onClick={() => dialog.current?.close()} aria-label='Close' className={btn}>
          <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' aria-hidden='true'><path d='M6 6l12 12M18 6L6 18' /></svg>
        </button>
      </div>
      <div data-backdrop='1' className='relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16'>
        <FullPhoto photo={photo} pds={pds} did={did} />
        {n > 1 && <>
          <button type='button' onClick={() => go(-1)} aria-label='Previous photo' className={`${btn} absolute left-2 top-1/2 -translate-y-1/2`}>
            <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M15 5l-7 7 7 7' /></svg>
          </button>
          <button type='button' onClick={() => go(1)} aria-label='Next photo' className={`${btn} absolute right-2 top-1/2 -translate-y-1/2`}>
            <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M9 5l7 7-7 7' /></svg>
          </button>
        </>}
      </div>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-4 pb-4 pt-2 text-sm'>
        {photo.alt && <p className='whitespace-pre-line text-[15px] text-white'>{photo.alt}</p>}
        <p className='text-white/70'>
          {credit.handle
            ? <a href={`/@${credit.handle}`} className='font-semibold text-white hover:underline'>@{credit.handle}</a>
            : <span className='font-semibold' title={credit.did}>{credit.did.slice(0, 16)}…</span>}
          {` · ${LICENSE_LABEL[lic] ?? lic}`}
        </p>
      </div>
    </div>
  </dialog>;
}

// A track's stats, its line (drawn from its GPX, fetched when shown), and
// its GPX to download.
export function TrackView({ track, pds, did }: { track: TrackRecord; pds: string; did: string }) {
  const units = useUnits();
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
    typeof track.distance === 'number' && kmText(track.distance, units),
    typeof track.gain === 'number' && `↑ ${elevation(track.gain, units)}`,
    typeof track.duration === 'number' && durationText(track.duration),
    stepsText(track.steps),
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
