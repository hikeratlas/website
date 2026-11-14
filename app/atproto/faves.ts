// Faves (com.hikeratlas.temp.fave, lexicons/com/hikeratlas/temp/fave.json):
// records in the user's own repository, one per route, whose record key is
// the route's key (routeKey.ts). The record holds only when: faving again
// replaces it, unfaving is one delete, and whether a route is faved is one
// lookup. What a fave is of comes from its key alone (findRoutes, on the
// people page).
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { FAVE } from './scope';

const xrpc = (session: OAuthSession, method: string, body?: unknown) =>
  session.fetchHandler(`/xrpc/${method}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

export async function isFaved(session: OAuthSession, key: string): Promise<boolean> {
  const at = `repo=${encodeURIComponent(session.did)}&collection=${FAVE}&rkey=${encodeURIComponent(key)}`;
  return (await xrpc(session, `com.atproto.repo.getRecord?${at}`)).ok;
}

export async function setFave(session: OAuthSession, key: string, on: boolean): Promise<void> {
  const r = on
    ? await xrpc(session, 'com.atproto.repo.putRecord', {
      repo: session.did, collection: FAVE, rkey: key,
      record: { $type: FAVE, createdAt: new Date().toISOString() },
    })
    : await xrpc(session, 'com.atproto.repo.deleteRecord', { repo: session.did, collection: FAVE, rkey: key });
  if (!r.ok) throw new Error(`${on ? 'Saving' : 'Removing'} the fave failed (${r.status})`);
}

// Someone's faves, newest first, from their PDS (public records: no session
// needed): up to 500, the PDS paging by 100.
export interface Fave { key: string; createdAt: string }
export async function listFaves(pds: string, did: string): Promise<Fave[]> {
  const out: Fave[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const u = new URL('/xrpc/com.atproto.repo.listRecords', pds);
    u.searchParams.set('repo', did);
    u.searchParams.set('collection', FAVE);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u);
    if (!r.ok) break;
    const j = await r.json() as { records: { uri: string; value: { createdAt?: unknown } }[]; cursor?: string };
    for (const rec of j.records) {
      const key = rec.uri.split('/').pop() ?? '';
      out.push({ key, createdAt: typeof rec.value?.createdAt === 'string' ? rec.value.createdAt : '' });
    }
    if (!j.cursor || j.records.length < 100) break;
    cursor = j.cursor;
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
