// Pieces of posts (reviews and tracks), shared by profile pages and hike
// pages' "From hikers": photos, and a track's stats, line and GPX.
import { useEffect, useState } from 'react';
import { lines, readBlob } from '~/atproto/gpx';
import { blobUrl, type Photo, type TrackRecord } from '~/atproto/posts';
import { durationText, kmText } from '~/components/PostDialog';
import { elevation, useUnits } from '~/units';

export const day = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

export function Photos({ photos, pds, did }: { photos: Photo[]; pds: string; did: string }) {
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
