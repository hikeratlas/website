// Faves (com.hikeratlas.temp.fave, lexicons/com/hikeratlas/temp/fave.json): records in
// the user's own repository, one per hike, under a record key derived from
// the hike's key, so faving again replaces it and unfaving is one delete.
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { FAVE } from './scope';

export interface FaveSubject {
  uri: string; // its page on Hiker Atlas
  title: string;
  key: string; // hikeratlas/routes' key
  park?: string;
  parkId?: string;
}

// sha-256 of the hike's key, base32 (lowercase), 26 characters: a valid
// record key whatever the key holds.
export async function faveKey(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const abc = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0, n = 0, out = '';
  for (const b of h) {
    n = (n << 8) | b; bits += 8;
    while (bits >= 5 && out.length < 26) { out += abc[(n >> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}

const xrpc = (session: OAuthSession, method: string, body?: unknown) =>
  session.fetchHandler(`/xrpc/${method}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

export async function isFaved(session: OAuthSession, key: string): Promise<boolean> {
  const rkey = await faveKey(key);
  const r = await xrpc(session, `com.atproto.repo.getRecord?repo=${encodeURIComponent(session.did)}&collection=${FAVE}&rkey=${rkey}`);
  return r.ok;
}

export async function setFave(session: OAuthSession, subject: FaveSubject, on: boolean): Promise<void> {
  const rkey = await faveKey(subject.key);
  const r = on
    ? await xrpc(session, 'com.atproto.repo.putRecord', {
      repo: session.did, collection: FAVE, rkey,
      record: { $type: FAVE, subject, createdAt: new Date().toISOString() },
    })
    : await xrpc(session, 'com.atproto.repo.deleteRecord', { repo: session.did, collection: FAVE, rkey });
  if (!r.ok) throw new Error(`${on ? 'Saving' : 'Removing'} the fave failed (${r.status})`);
}
