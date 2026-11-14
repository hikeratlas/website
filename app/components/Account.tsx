// Signing in (an AT Protocol account: Bluesky, or any PDS) and faving hikes.
// The sign-in dialog, the header's account button, and the hike sheet's fave
// button.
import { useEffect, useRef, useState } from 'react';
import { BLUESKY, signIn, signOut, useAtSession } from '~/atproto/session';
import { isFaved, setFave } from '~/atproto/faves';
import { routeKey, shapeFor } from '~/atproto/routeKey';

export function SignInDialog({ onClose, why }: { onClose: () => void; why?: string }) {
  const [other, setOther] = useState(false);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const go = async (who: string) => {
    setBusy(true); setError(null);
    try {
      await signIn(who);
    } catch (err) {
      setBusy(false);
      setError(who !== BLUESKY && err instanceof Error && /resolve|handle/i.test(err.message)
        ? `Couldn't find ${who.trim()}. Check the handle (e.g. you.example.com).`
        : 'Signing in didn\'t work. Try again?');
    }
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (handle.trim()) go(handle); };
  return <dialog ref={dialog} onClose={onClose} className='w-[min(420px,calc(100%-32px))] rounded-2xl p-0 shadow-xl backdrop:bg-black/40'>
    <div className='flex flex-col gap-3 p-5'>
      <h2 className='font-display text-xl font-extrabold'>Sign in</h2>
      {why && <p className='text-sm text-stone-700'>{why}</p>}
      <p className='text-sm text-stone-600'>Your faves are saved to your own account, so they&apos;re always yours. They&apos;re public: see <a href='/terms' className='text-blue-700 hover:underline'>terms and privacy</a>.</p>
      <button type='button' onClick={() => go(BLUESKY)} disabled={busy}
        className='flex h-11 items-center justify-center rounded-xl bg-[#1185fe] text-sm font-semibold text-white hover:bg-[#0a6fd8] disabled:opacity-60'>
        {busy && !other ? 'Going to Bluesky…' : 'Continue with Bluesky'}
      </button>
      {other && <form onSubmit={submit} className='flex flex-col gap-2'>
        <label htmlFor='at-handle' className='text-sm font-semibold'>Your handle</label>
        <input id='at-handle' autoCapitalize='none' autoCorrect='off' spellCheck={false} placeholder='you.example.com'
          value={handle} onChange={(e) => setHandle(e.target.value)}
          className='h-11 rounded-xl border border-stone-300 px-3 text-base' />
        <button type='submit' disabled={busy} className='h-11 rounded-xl border border-stone-300 text-sm font-semibold hover:bg-stone-50 disabled:opacity-60'>
          {busy ? 'Going to your account…' : 'Continue'}
        </button>
      </form>}
      {error && <p className='text-sm text-red-700'>{error}</p>}
      <div className='flex items-center justify-between gap-2 text-xs text-stone-500'>
        {other
          ? <span>Any AT Protocol account works.</span>
          : <button type='button' onClick={() => setOther(true)} className='hover:underline'>Use a non-Bluesky account</button>}
        <button type='button' onClick={() => dialog.current?.close()} className='rounded-lg px-2 py-1 text-sm font-semibold text-stone-700 hover:bg-stone-100'>Cancel</button>
      </div>
    </div>
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
// first). A fave is of its route's key, made from its line and shape.
export function FaveButton({ title, line, shape }: { title: string; line: [number, number][]; shape: string }) {
  const at = useAtSession();
  const [key, setKey] = useState<string | null>(null);
  const [faved, setFaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = at.status === 'in' ? at.session : null;
  useEffect(() => {
    let live = true;
    setKey(null);
    routeKey(line, shapeFor(shape)).then((k) => { if (live) setKey(k); }).catch(() => {});
    return () => { live = false; };
  }, [line, shape]);
  useEffect(() => {
    setFaved(null);
    if (!session || !key) return;
    let live = true;
    isFaved(session, key).then((f) => { if (live) setFaved(f); }).catch(() => {});
    return () => { live = false; };
  }, [session, key]);
  const toggle = async () => {
    if (!session) { setAsking(true); return; }
    if (!key) return;
    const on = !faved;
    setBusy(true); setError(null); setFaved(on);
    try { await setFave(session, key, on); }
    catch (e) { setFaved(!on); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <button type='button' onClick={toggle} disabled={busy || at.status === 'loading' || (!!session && !key)} aria-pressed={!!faved}
      title={faved ? 'Remove from your faves' : 'Save to your faves'}
      className={`tap flex h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${faved ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-stone-300 hover:bg-stone-50'}`}>
      <svg viewBox='0 0 24 24' className='h-5 w-5' fill={faved ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='2' strokeLinejoin='round' aria-hidden='true'>
        <path d='M12 20.5s-7.5-4.4-9.3-9.2C1.4 7.7 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.2 4.3 6.8-1.8 4.8-9.3 9.2-9.3 9.2z' />
      </svg>
      <span className='sr-only'>{faved ? 'Faved' : 'Fave'}</span>
    </button>
    {error && <span role='alert' className='basis-full text-sm text-red-700'>{error}</span>}
    {asking && <SignInDialog onClose={() => setAsking(false)} why={`Sign in to save ${title} to your faves.`} />}
  </>;
}
