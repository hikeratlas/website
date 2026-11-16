// Editing a review you posted (website#159), from your profile: its words,
// when you hiked it, its tags, its photos' descriptions (or removing
// photos), and its licence, which applies from then on (copies already made
// keep the one they came with, as on Flickr). It's saved over the old
// record (editReview), so links to it keep working; when it was posted, its
// hike and its track stay as they were.
import { useEffect, useRef, useState } from 'react';
import { blobUrl, editReview, LICENSES, TAGS, type Rec, type ReviewRecord } from '~/atproto/posts';
import { measurePhoto } from '~/atproto/photos';
import { PhotoImg } from '~/components/Posts';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { LICENSE_LABEL, localDay, MAX_TEXT, noonOf, today } from '~/components/PostDialog';

export function EditReviewDialog({ review, session, pds, onClose, onSaved }: {
  review: Rec<ReviewRecord>; session: OAuthSession; pds: string; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const r = review.value;
  const [day, setDay] = useState(r.hikedAt ? localDay(r.hikedAt) : '');
  const [text, setText] = useState(r.text);
  const [tags, setTags] = useState<string[]>(r.tags ?? []);
  const [photos, setPhotos] = useState(r.photos ?? []);
  // A review without one is Hiker Atlas only (the lexicon's default).
  const was = r.license ?? 'hikeratlas-only';
  const [license, setLicense] = useState(was);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = text.trim().length > 0 && text.length <= MAX_TEXT && !busy;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await editReview(session, review, {
        text: text.trim(),
        // A review posted without a date keeps none, unless one is picked.
        hikedAt: day ? (r.hikedAt && localDay(r.hikedAt) === day ? r.hikedAt : noonOf(day)) : undefined,
        tags,
        photos: await Promise.all(photos.map(async (p) => {
          const out = { ...p };
          if (p.alt?.trim()) out.alt = p.alt.trim(); else delete out.alt;
          // A photo posted before aspectRatio was required gets it now, or
          // the review wouldn't validate (#177).
          if (!p.aspectRatio) out.aspectRatio = await measurePhoto(blobUrl(pds, session.did, p.image));
          return out;
        })),
        // Written only when changed, so a review without one stays without.
        license: license !== was ? license : r.license,
      });
      onSaved();
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = 'text-sm font-semibold';
  return <dialog ref={dialog} onClose={onClose} className='max-h-[85dvh] w-[min(560px,calc(100%-24px))] overflow-hidden rounded-2xl p-0 shadow-xl backdrop:bg-black/40'>
    <form method='dialog' onSubmit={(e) => { e.preventDefault(); save(); }} className='flex max-h-[85dvh] flex-col'>
      <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5'>
        <h2 className='font-display text-xl font-extrabold'>Edit your review</h2>

        <label className='flex flex-col gap-1'>
          <span className={label}>When you hiked it</span>
          <input type='date' value={day} max={today()} onChange={(e) => setDay(e.target.value)}
            className='h-11 w-48 rounded-xl border border-stone-300 px-3 text-base' />
        </label>

        <label className='flex flex-col gap-1'>
          <span className={label}>Review</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={MAX_TEXT + 500}
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
        </fieldset>

        {photos.length > 0 && <div className='flex flex-col gap-1'>
          <span className={label}>Photos</span>
          <ul className='flex flex-col gap-2'>
            {photos.map((p, i) => <li key={p.image.ref.$link} className='flex items-center gap-2'>
              <PhotoImg photo={p} pds={pds} did={session.did} alt='' className='h-14 w-14 shrink-0 rounded-lg object-cover' />
              <input value={p.alt ?? ''} placeholder='Describe it (for people who can’t see it)' aria-label={`Description of photo ${i + 1}`}
                onChange={(e) => setPhotos(photos.map((q, j) => (j === i ? { ...q, alt: e.target.value } : q)))}
                className='h-10 min-w-0 flex-1 rounded-lg border border-stone-300 px-2 text-sm' />
              <button type='button' aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                className='h-10 w-10 shrink-0 rounded-lg text-stone-500 hover:bg-stone-100'>×</button>
            </li>)}
          </ul>
        </div>}

        <label className='flex flex-col gap-1'>
          <span className={label}>Licence</span>
          <select value={license} onChange={(e) => setLicense(e.target.value)} className='h-11 w-64 rounded-xl border border-stone-300 px-3 text-base'>
            {LICENSES.map((l) => <option key={l} value={l}>{LICENSE_LABEL[l]}</option>)}
          </select>
          <span className='text-xs text-stone-500'>
            {license !== was
              ? <>Applies to this review and its photos from now on. Anyone who already copied it under {LICENSE_LABEL[was] ?? was} keeps what that allowed.</>
              : <>What others may do with this review and its photos (<a href='/terms#what-you-post' className='text-blue-700 hover:underline'>what that means</a>).</>}
          </span>
        </label>

        <p className='text-xs text-stone-600'>
          The edit replaces the review in your account. Apps that copied it while it was public may keep the old version.
        </p>
        {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
      </div>
      <div className='flex shrink-0 justify-end gap-2 border-t border-stone-200 bg-white px-5 py-3'>
        <button type='button' onClick={() => dialog.current?.close()} className='tap h-11 rounded-xl px-4 text-sm font-semibold text-stone-700 hover:bg-stone-100'>Cancel</button>
        <button type='submit' disabled={!canSave}
          className='tap h-11 rounded-xl bg-green-900 px-5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </dialog>;
}
