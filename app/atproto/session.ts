// Signing in with an AT Protocol account (Bluesky, or any PDS), in the
// browser: the OAuth session lives in this browser (IndexedDB), and Hiker
// Atlas writes to the user's own repository with it. No server of ours holds
// it, or their data.
//
// One store for the page: who's signed in (useAtSession), sign in and out.
import { useSyncExternalStore } from 'react';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';
import { PROFILE } from './scope';

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
        // Bluesky's, for a handle typed ("Use another account").
        handleResolver: 'https://bsky.social',
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
        ensureProfile(r.session);
        return r;
      })
      .catch(() => { set({ status: 'out' }); return null; });
  }
  return initP;
}

// That this account uses Hiker Atlas (com.hikeratlas.temp.actor.profile/self,
// lexicons/com/hikeratlas/temp/actor/profile.json): written once, the first time
// it signs in, and never overwritten. Indexers find our users by it, whether
// or not they've faved anything.
async function ensureProfile(session: OAuthSession) {
  try {
    const at = `repo=${encodeURIComponent(session.did)}&collection=${PROFILE}&rkey=self`;
    const r = await session.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${at}`);
    if (r.ok || r.status !== 400) return; // there already (or the PDS is down: next time)
    await session.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: session.did, collection: PROFILE, rkey: 'self', record: { $type: PROFILE, createdAt: new Date().toISOString() } }),
    });
  } catch { /* next sign-in */ }
}

async function handleOf(session: OAuthSession): Promise<string | null> {
  try {
    const r = await session.fetchHandler(`/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(session.did)}`);
    return r.ok ? ((await r.json()) as { handle?: string }).handle ?? null : null;
  } catch {
    return null;
  }
}

// To sign in, coming back to this page: at Bluesky (BLUESKY, its sign-in
// page asks who), or at the PDS of a handle typed.
export const BLUESKY = 'https://bsky.social';
export async function signIn(who: string) {
  const c = await client();
  const back = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  await c.signIn(who === BLUESKY ? who : who.trim().replace(/^@/, ''), { state: back });
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
