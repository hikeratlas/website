// Signing in (an AT Protocol account: Bluesky, or any PDS) and faving hikes.
// The sign-in dialog, the header's account button, and the hike sheet's fave
// button.
import { useEffect, useRef, useState } from 'react';
import { signIn, signOut, useAtSession } from '~/atproto/session';
import { isFaved, setFave, type FaveSubject } from '~/atproto/faves';

export function SignInDialog({ onClose, why }: { onClose: () => void; why?: string }) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true); setError(null);
    try {
      await signIn(handle);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error && /resolve|handle/i.test(err.message)
        ? `Couldn't find ${handle.trim()}. Check the handle (e.g. you.bsky.social).`
        : 'Signing in didn\'t work. Try again?');
    }
  };
  return <dialog ref={dialog} onClose={onClose} className='w-[min(420px,calc(100%-32px))] rounded-2xl p-0 shadow-xl backdrop:bg-black/40'>
    <form onSubmit={submit} className='flex flex-col gap-3 p-5'>
      <h2 className='font-display text-xl font-extrabold'>Sign in</h2>
      {why && <p className='text-sm text-stone-700'>{why}</p>}
      <p className='text-sm text-stone-600'>
        Use your Bluesky handle, or any AT Protocol account. Your faves are saved in your own account, not ours, so you can take them anywhere.
      </p>
      <label htmlFor='at-handle' className='text-sm font-semibold'>Handle</label>
      <input id='at-handle' autoCapitalize='none' autoCorrect='off' spellCheck={false} placeholder='you.bsky.social'
        value={handle} onChange={(e) => setHandle(e.target.value)}
        className='h-11 rounded-xl border border-stone-300 px-3 text-base' />
      {error && <p className='text-sm text-red-700'>{error}</p>}
      <div className='flex gap-2'>
        <button type='submit' disabled={busy} className='h-11 flex-1 rounded-xl bg-green-900 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60'>
          {busy ? 'Going to your account…' : 'Continue'}
        </button>
        <button type='button' onClick={() => dialog.current?.close()} className='h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50'>Cancel</button>
      </div>
      <p className='text-xs text-stone-500'>No account? <a href='https://bsky.app' className='text-blue-700 hover:underline'>Make one on Bluesky</a>.</p>
    </form>
  </dialog>;
}

// The header's: "Sign in", or your handle (to your faves) and "Sign out".
export function AccountButton() {
  const at = useAtSession();
  const [open, setOpen] = useState(false);
  if (at.status === 'loading') return null;
  if (at.status === 'out') {
    return <>
      <button type='button' onClick={() => setOpen(true)} className='text-sm text-blue-700 hover:underline'>Sign in</button>
      {open && <SignInDialog onClose={() => setOpen(false)} />}
    </>;
  }
  const who = at.handle ?? at.did;
  return <span className='flex items-center gap-2 text-sm'>
    <a href={`/people/${encodeURIComponent(who)}`} className='text-blue-700 hover:underline'>@{at.handle ?? 'you'}</a>
    <button type='button' onClick={() => signOut()} className='text-stone-500 hover:underline'>Sign out</button>
  </span>;
}

// The hike sheet's: a heart, saving the hike to your faves (or signing in
// first).
export function FaveButton({ subject: hike }: { subject: Omit<FaveSubject, 'uri'> }) {
  // Its page: the map page's URL, which follows the hike open.
  const subject: FaveSubject = { ...hike, uri: `https://www.hikeratlas.com${typeof window === 'undefined' ? '' : window.location.pathname}` };
  const at = useAtSession();
  const [faved, setFaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = at.status === 'in' ? at.session : null;
  useEffect(() => {
    setFaved(null);
    if (!session) return;
    let live = true;
    isFaved(session, subject.key).then((f) => { if (live) setFaved(f); }).catch(() => {});
    return () => { live = false; };
  }, [session, subject.key]);
  const toggle = async () => {
    if (!session) { setAsking(true); return; }
    const on = !faved;
    setBusy(true); setError(null); setFaved(on);
    try { await setFave(session, subject, on); }
    catch (e) { setFaved(!on); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <button type='button' onClick={toggle} disabled={busy || at.status === 'loading'} aria-pressed={!!faved}
      title={faved ? 'Remove from your faves' : 'Save to your faves'}
      className={`tap flex h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${faved ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-stone-300 hover:bg-stone-50'}`}>
      <svg viewBox='0 0 24 24' className='h-5 w-5' fill={faved ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2' strokeLinejoin='round' aria-hidden='true'>
        <path d='M12 20.5s-7.5-4.4-9.3-9.2C1.4 7.7 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.2 4.3 6.8-1.8 4.8-9.3 9.2-9.3 9.2z' />
      </svg>
      <span className='sr-only'>{faved ? 'Faved' : 'Fave'}</span>
    </button>
    {error && <span role='alert' className='basis-full text-sm text-red-700'>{error}</span>}
    {asking && <SignInDialog onClose={() => setAsking(false)} why={`Sign in to save ${subject.title} to your faves.`} />}
  </>;
}
