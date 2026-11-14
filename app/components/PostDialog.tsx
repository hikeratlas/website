// "Hiked it?": posting a review and/or a GPX track of a hike, from its sheet
// (website#130). Both are records in the poster's own AT Protocol
// repository (atproto/posts.ts), tied to the hike by its route key. A track
// is the GPX of one outing: several files (a multi-day trip's days) become
// one. Photos go on the review, or on the track if there's no review.
import { useEffect, useRef, useState } from 'react';
import { describeDid } from '~/atproto/identity';
import { combine, stats, type GpxStats } from '~/atproto/gpx';
import { preparePhoto, type PreparedPhoto } from '~/atproto/photos';
import { DEFAULT_LICENSE, getSettings, publishReview, publishTrack, TAGS, type StrongRef } from '~/atproto/posts';
import { routeKey, shapeFor } from '~/atproto/routeKey';
import { useAtSession } from '~/atproto/session';
import { SignInDialog } from '~/components/Account';

const MAX_TEXT = 3000;
const MAX_PHOTOS = 10;

export const LICENSE_LABEL: Record<string, string> = {
  'CC0-1.0': 'public domain (CC0)',
  'CC-BY-4.0': 'CC BY 4.0',
  'hikeratlas-only': 'Hiker Atlas only',
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// A date as a datetime: noon local time, so it reads as the same day
// anywhere near (AT Protocol has no date-only format).
const noonOf = (day: string) => new Date(`${day}T12:00:00`).toISOString();
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function kmText(m: number) { return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`; }
export function durationText(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h >= 48) return `${Math.round(s / 86400)} days`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

// The sheet's button, and the dialog it opens (or signing in first).
export function PostButton({ title, line, shape }: { title: string; line: [number, number][]; shape: string }) {
  const at = useAtSession();
  const [open, setOpen] = useState(false);
  return <section className='flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3'>
    <div className='text-sm'>
      <div className='font-semibold'>Hiked it?</div>
      <div className='text-stone-600'>Post a review, photos or your GPX track.</div>
    </div>
    <button type='button' onClick={() => setOpen(true)} disabled={at.status === 'loading'}
      className='tap h-11 shrink-0 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50'>Post</button>
    {open && (at.status === 'in'
      ? <PostDialog title={title} line={line} shape={shape} onClose={() => setOpen(false)} />
      : <SignInDialog onClose={() => setOpen(false)} why={`Sign in to post about ${title}.`} />)}
  </section>;
}

interface Picked { file: File; url: string; prepared: Promise<PreparedPhoto>; alt: string }

function PostDialog({ title, line, shape, onClose }: { title: string; line: [number, number][]; shape: string; onClose: () => void }) {
  const at = useAtSession();
  const session = at.status === 'in' ? at.session : null;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const [key, setKey] = useState<string | null>(null);
  const [pds, setPds] = useState<string | null>(null);
  const [license, setLicense] = useState<string>(DEFAULT_LICENSE);
  useEffect(() => {
    let live = true;
    routeKey(line, shapeFor(shape)).then((k) => { if (live) setKey(k); }).catch(() => {});
    return () => { live = false; };
  }, [line, shape]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    describeDid(session.did).then(async (d) => {
      if (!live || !d) return;
      setPds(d.pds);
      const s = await getSettings(d.pds, session.did).catch(() => ({ license: undefined }));
      if (live && s.license && LICENSE_LABEL[s.license]) setLicense(s.license);
    });
    return () => { live = false; };
  }, [session]);

  const [day, setDay] = useState(today());
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [gpx, setGpx] = useState<{ names: string[]; text: string; stats: GpxStats } | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const pickGpx = async (files: FileList | null) => {
    setGpxError(null);
    if (!files?.length) { setGpx(null); return; }
    try {
      const list = Array.from(files);
      const one = combine(await Promise.all(list.map((f) => f.text())));
      const s = stats(one);
      setGpx({ names: list.map((f) => f.name), text: one, stats: s });
      // The day it started, if the trace says.
      if (s.startedAt) setDay(localDay(s.startedAt));
    } catch (e) {
      setGpx(null);
      setGpxError(e instanceof Error ? e.message : String(e));
    }
  };
  const pickPhotos = (files: FileList | null) => {
    const add = Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length)
      .map((file) => ({ file, url: URL.createObjectURL(file), prepared: preparePhoto(file), alt: '' }));
    // Don't let a failed one reject unobserved; it fails the post instead.
    add.forEach((p) => p.prepared.catch(() => {}));
    setPhotos([...photos, ...add]);
  };

  const canPost = !!session && !!pds && !!key && (text.trim().length > 0 || !!gpx) && !busy && text.length <= MAX_TEXT;
  const post = async () => {
    if (!session || !pds || !key) return;
    setError(null);
    try {
      setBusy(photos.length ? 'Preparing photos…' : 'Posting…');
      const ready = await Promise.all(photos.map(async (p) => ({ ...(await p.prepared), alt: p.alt.trim() || undefined })));
      const review = text.trim().length > 0;
      let track: StrongRef | undefined;
      if (gpx) {
        setBusy('Uploading your track…');
        track = await publishTrack(session, pds, {
          gpx: gpx.text, stats: gpx.stats, routeKey: key, title,
          photos: review ? [] : ready,
        });
      }
      if (review) {
        setBusy('Posting your review…');
        await publishReview(session, pds, {
          text: text.trim(), hikedAt: noonOf(day), routeKey: key, track, tags, photos: ready,
        });
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const me = at.status === 'in' ? at.handle ?? at.did : '';
  const label = 'text-sm font-semibold';
  return <dialog ref={dialog} onClose={onClose} className='max-h-[85dvh] w-[min(560px,calc(100%-24px))] overflow-hidden rounded-2xl p-0 shadow-xl backdrop:bg-black/40'>
    {done
      ? <div className='flex flex-col gap-3 p-5'>
        <h2 className='font-display text-xl font-extrabold'>Posted</h2>
        <p className='text-sm text-stone-700'>Thanks! It’s on your profile, and in your own account for any app to show.</p>
        <div className='flex justify-end gap-2'>
          <a href={`/people/${encodeURIComponent(me)}`} className='tap flex h-11 items-center rounded-xl bg-green-900 px-4 text-sm font-semibold text-white hover:bg-green-800'>See your profile</a>
          <button type='button' onClick={() => dialog.current?.close()} className='tap h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50'>Close</button>
        </div>
      </div>
      : <form method='dialog' onSubmit={(e) => { e.preventDefault(); post(); }} className='flex max-h-[85dvh] flex-col'>
        {/* The fields scroll; the buttons stay below them. */}
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5'>
        <div>
          <h2 className='font-display text-xl font-extrabold'>{title}</h2>
          <p className='text-sm text-stone-600'>A review, photos, your GPX track, or all three.</p>
        </div>

        <label className='flex flex-col gap-1'>
          <span className={label}>When you hiked it</span>
          <input type='date' value={day} max={today()} onChange={(e) => setDay(e.target.value || today())}
            className='h-11 w-48 rounded-xl border border-stone-300 px-3 text-base' />
        </label>

        <label className='flex flex-col gap-1'>
          <span className={label}>Review</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={MAX_TEXT + 500}
            placeholder='How was it? Trail conditions, highlights, tips.'
            className='rounded-xl border border-stone-300 p-3 text-base' />
          {text.length > MAX_TEXT * 0.9 && <span className={`text-xs ${text.length > MAX_TEXT ? 'text-red-700' : 'text-stone-500'}`}>{text.length} / {MAX_TEXT}</span>}
        </label>

        <fieldset className='flex flex-col gap-1.5'>
          <legend className={`${label} mb-1.5`}>Conditions and highlights</legend>
          <div className='flex flex-wrap gap-1.5'>
            {TAGS.map(([k, name]) => {
              const on = tags.includes(k);
              return <button key={k} type='button' aria-pressed={on}
                onClick={() => setTags(on ? tags.filter((t) => t !== k) : [...tags, k])}
                className={`rounded-full border px-3 py-1 text-[13px] ${on ? 'border-green-800 bg-green-900 text-white' : 'border-stone-300 hover:bg-stone-50'}`}>{name}</button>;
            })}
          </div>
          {tags.length > 0 && !text.trim() && <span className='text-xs text-stone-500'>Tags go with a review: write a few words to post them.</span>}
        </fieldset>

        <div className='flex flex-col gap-1'>
          <span className={label}>Photos</span>
          {photos.length > 0 && <ul className='flex flex-col gap-2'>
            {photos.map((p, i) => <li key={p.url} className='flex items-center gap-2'>
              <img src={p.url} alt='' className='h-14 w-14 shrink-0 rounded-lg object-cover' />
              <input value={p.alt} placeholder='Describe it (for people who can’t see it)' aria-label={`Description of photo ${i + 1}`}
                onChange={(e) => setPhotos(photos.map((q, j) => (j === i ? { ...q, alt: e.target.value } : q)))}
                className='h-10 min-w-0 flex-1 rounded-lg border border-stone-300 px-2 text-sm' />
              <button type='button' aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                className='h-10 w-10 shrink-0 rounded-lg text-stone-500 hover:bg-stone-100'>×</button>
            </li>)}
          </ul>}
          {photos.length < MAX_PHOTOS && <input type='file' accept='image/*' multiple onChange={(e) => { pickPhotos(e.target.files); e.target.value = ''; }}
            className='text-sm file:mr-3 file:h-10 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:text-sm file:font-semibold' />}
          <span className='text-xs text-stone-500'>Their location data is removed.</span>
        </div>

        <div className='flex flex-col gap-1'>
          <span className={label}>GPX track</span>
          <input type='file' accept='.gpx,application/gpx+xml' multiple onChange={(e) => pickGpx(e.target.files)}
            className='text-sm file:mr-3 file:h-10 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:text-sm file:font-semibold' />
          <span className='text-xs text-stone-500'>For a trip over several days, pick each day’s file: they’re joined into one track.</span>
          {gpx && <span className='text-sm text-stone-700'>
            {[kmText(gpx.stats.distance), gpx.stats.gain !== null && `↑ ${gpx.stats.gain.toLocaleString('en-US')} m`,
              gpx.stats.duration !== null && durationText(gpx.stats.duration)].filter(Boolean).join(' · ')}
            {gpx.names.length > 1 && ` (${gpx.names.length} files)`}
          </span>}
          {gpxError && <span role='alert' className='text-sm text-red-700'>{gpxError}</span>}
          {gpx && <span className='text-xs text-stone-500'>Your track shows where you went, and when, to anyone.</span>}
        </div>

        <p className='text-xs text-stone-600'>
          Posts are public, and stay in your own account. You keep ownership; this one is shared under{' '}
          <strong>{LICENSE_LABEL[license]}</strong> (<a href={`/people/${encodeURIComponent(me)}#settings`} className='text-blue-700 hover:underline'>change</a>,{' '}
          <a href='/terms#what-you-post' className='text-blue-700 hover:underline'>what that means</a>).
        </p>

        {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
        </div>
        <div className='flex shrink-0 justify-end gap-2 border-t border-stone-200 bg-white px-5 py-3'>
          <button type='button' onClick={() => dialog.current?.close()} className='tap h-11 rounded-xl px-4 text-sm font-semibold text-stone-700 hover:bg-stone-100'>Cancel</button>
          <button type='submit' disabled={!canPost}
            className='tap h-11 rounded-xl bg-green-900 px-5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'>{busy ?? 'Post'}</button>
        </div>
      </form>}
  </dialog>;
}
