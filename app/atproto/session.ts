// Signing in with an AT Protocol account (Bluesky, or any PDS), in the
// browser: the OAuth session lives in this browser (IndexedDB), and Hiker
// Atlas writes to the user's own repository with it. No server of ours holds
// it, or their data.
//
// One store for the page: who's signed in (useAtSession), sign in and out.
import { useSyncExternalStore } from 'react';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';

export type AtState =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; did: string; handle: string | null; session: OAuthSession };

let state: AtState = { status: 'loading' };
const listeners = new Set<() => void>();
const set = (s: AtState) => { state = s; listeners.forEach((l) => l()); };

let clientP: Promise<BrowserOAuthClient> | null = null;
function client(): Promise<BrowserOAuthClient> {
  if (!clientP) {
    // Loaded only when needed: most visitors never sign in.
    clientP = import('@atproto/oauth-client-browser').then(({ BrowserOAuthClient }) =>
      BrowserOAuthClient.load({
        clientId: `${window.location.origin}/oauth-client-metadata.json`,
        // Our own resolveHandle (app/routes/xrpc.[...].ts), not Bluesky's.
        handleResolver: window.location.origin,
        // Expired or revoked: signed out.
        onSessionDeleted: () => set({ status: 'out' }),
      }));
  }
  return clientP;
}

// The client's init(), once a page: restores the last session, or finishes
// a sign-in (the callback page), giving its state (where to go back to).
let initP: Promise<{ session: OAuthSession; state?: string | null } | null> | null = null;
export function init() {
  if (!initP) {
    initP = client()
      .then(async (c) => {
        const r = await c.init();
        if (!r) { set({ status: 'out' }); return null; }
        set({ status: 'in', did: r.session.did, handle: null, session: r.session });
        handleOf(r.session).then((handle) => {
          if (state.status === 'in' && state.did === r.session.did) set({ ...state, handle });
        });
        return r;
      })
      .catch(() => { set({ status: 'out' }); return null; });
  }
  return initP;
}

async function handleOf(session: OAuthSession): Promise<string | null> {
  try {
    const r = await session.fetchHandler(`/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(session.did)}`);
    return r.ok ? ((await r.json()) as { handle?: string }).handle ?? null : null;
  } catch {
    return null;
  }
}

// To the user's PDS to sign in, coming back to this page.
export async function signIn(handle: string) {
  const c = await client();
  const back = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  await c.signIn(handle.trim().replace(/^@/, ''), { state: back });
}

export async function signOut() {
  if (state.status === 'in') {
    try { await state.session.signOut(); } catch { /* signed out here anyway */ }
  }
  set({ status: 'out' });
}

export function useAtSession(): AtState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); if (typeof window !== 'undefined') init(); return () => listeners.delete(l); },
    () => state,
    () => ({ status: 'loading' }) as AtState,
  );
}
