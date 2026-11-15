// Tracks and reviews (com.hikeratlas.temp.track and .review, in
// hikeratlas/atproto-lexicon): records in the user's own repository, keyed
// by TIDs the PDS makes (createRecord with no rkey), so someone can post
// any number for the same hike. Their GPX and photos are blobs uploaded to
// the same PDS. Each post records the licence it was made under, from the
// profile's setting at the time (terms: "What you post is yours").
//
// Read back from the author's PDS (public records: no session needed), for
// their profile page; an indexer can gather everyone's later.
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { PROFILE, REVIEW, TRACK } from './scope';
import { gzip } from './gpx';
import { parseAtUri } from './postLists';
import type { PreparedPhoto } from './photos';
import { notifyIndexer } from './indexer';

export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'hikeratlas-only'] as const;
export type License = typeof LICENSES[number];
export const DEFAULT_LICENSE: License = 'CC0-1.0';

// What the review form offers (the lexicon's knownValues), with labels.
export const TAGS: [string, string][] = [
  ['views', 'Views'], ['quiet', 'Quiet'], ['crowded', 'Crowded'], ['wildflowers', 'Wildflowers'],
  ['fall-colours', 'Fall colours'], ['wildlife', 'Wildlife'], ['bugs', 'Bugs'], ['mud', 'Mud'],
  ['snow', 'Snow'], ['ice', 'Ice'], ['water-crossing', 'Water crossing'], ['blowdown', 'Blowdown'],
  ['washout', 'Washout'], ['closed', 'Closed'],
];
export const tagLabel = (t: string) => TAGS.find(([k]) => k === t)?.[1] ?? t;

export interface BlobRef { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number }
export interface StrongRef { uri: string; cid: string }
export interface Photo { image: BlobRef; alt?: string; takenAt?: string; at?: { lat: number; lon: number } }

// Degrees as the lexicon's integer microdegrees (defs#point).
const micro = (x: number) => Math.round(x * 1e6);

async function call(session: OAuthSession, method: string, body: unknown): Promise<Response> {
  const r = await session.fetchHandler(`/xrpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = '';
    try { msg = ((await r.json()) as { message?: string }).message ?? ''; } catch { /* no body */ }
    throw new Error(`${method.split('.').pop()} failed (${r.status})${msg ? `: ${msg}` : ''}`);
  }
  return r;
}

export async function uploadBlob(session: OAuthSession, data: Blob | Uint8Array, mimeType: string): Promise<BlobRef> {
  const r = await session.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST', headers: { 'content-type': mimeType }, body: data as BodyInit,
  });
  if (!r.ok) throw new Error(`Uploading a file failed (${r.status})`);
  return ((await r.json()) as { blob: BlobRef }).blob;
}

async function uploadPhotos(session: OAuthSession, photos: (PreparedPhoto & { alt?: string })[]): Promise<Photo[]> {
  const out: Photo[] = [];
  for (const p of photos) {
    const image = await uploadBlob(session, p.blob, 'image/jpeg');
    out.push({
      image, ...(p.alt ? { alt: p.alt } : {}), ...(p.takenAt ? { takenAt: p.takenAt } : {}),
      ...(p.lat !== null && p.lon !== null ? { at: { lat: micro(p.lat), lon: micro(p.lon) } } : {}),
    });
  }
  return out;
}

// The profile record's settings (actor.profile/self).
export interface Settings { license?: string; units?: { distance?: string; elevation?: string } }

export async function getSettings(pds: string, did: string): Promise<Settings & { createdAt?: string }> {
  const r = await getRecord(pds, did, PROFILE, 'self');
  return (r?.value as Settings & { createdAt?: string }) ?? {};
}

// Changes settings, keeping the record's other fields (createdAt).
export async function saveSettings(session: OAuthSession, pds: string, change: Settings): Promise<void> {
  const now = await getSettings(pds, session.did);
  await call(session, 'com.atproto.repo.putRecord', {
    repo: session.did, collection: PROFILE, rkey: 'self',
    record: { createdAt: new Date().toISOString(), ...now, ...change, $type: PROFILE },
  });
}

async function licenseFor(session: OAuthSession, pds: string): Promise<string> {
  const l = (await getSettings(pds, session.did).catch(() => ({} as Settings))).license;
  return l && (LICENSES as readonly string[]).includes(l) ? l : DEFAULT_LICENSE;
}

export interface TrackInput {
  gpx: string; // one GPX for the outing (gpx.ts combine)
  stats: { startedAt: string | null; duration: number | null; distance: number; gain: number | null };
  routeKey?: string;
  title?: string;
  photos?: (PreparedPhoto & { alt?: string })[];
}

export async function publishTrack(session: OAuthSession, pds: string, t: TrackInput): Promise<StrongRef> {
  const license = await licenseFor(session, pds);
  const gpx = await uploadBlob(session, await gzip(t.gpx), 'application/gzip');
  const photos = t.photos?.length ? await uploadPhotos(session, t.photos) : [];
  const s = t.stats;
  const record = {
    $type: TRACK, gpx, createdAt: new Date().toISOString(), license,
    ...(s.startedAt ? { startedAt: s.startedAt } : {}),
    ...(s.duration !== null ? { duration: s.duration } : {}),
    distance: s.distance,
    ...(s.gain !== null ? { gain: s.gain } : {}),
    ...(t.title ? { title: t.title } : {}),
    ...(t.routeKey ? { routeKey: t.routeKey } : {}),
    ...(photos.length ? { photos } : {}),
  };
  const r = await call(session, 'com.atproto.repo.createRecord', { repo: session.did, collection: TRACK, record });
  const ref = (await r.json()) as StrongRef;
  notifyIndexer(ref.uri, t.routeKey);
  return ref;
}

export interface ReviewInput {
  text: string;
  hikedAt?: string;
  routeKey?: string;
  track?: StrongRef;
  tags?: string[];
  photos?: (PreparedPhoto & { alt?: string })[];
}

export async function publishReview(session: OAuthSession, pds: string, v: ReviewInput): Promise<StrongRef> {
  const license = await licenseFor(session, pds);
  const photos = v.photos?.length ? await uploadPhotos(session, v.photos) : [];
  const record = {
    $type: REVIEW, text: v.text, createdAt: new Date().toISOString(), license,
    ...(v.hikedAt ? { hikedAt: v.hikedAt } : {}),
    ...(v.routeKey ? { routeKey: v.routeKey } : {}),
    ...(v.track ? { track: { uri: v.track.uri, cid: v.track.cid } } : {}),
    ...(v.tags?.length ? { tags: v.tags } : {}),
    ...(photos.length ? { photos } : {}),
  };
  const r = await call(session, 'com.atproto.repo.createRecord', { repo: session.did, collection: REVIEW, record });
  const ref = (await r.json()) as StrongRef;
  notifyIndexer(ref.uri, v.routeKey);
  return ref;
}

// What editing a review can change. Everything else (when it was posted, its
// licence, its route, its track) stays as it was.
export interface ReviewEdit { text: string; hikedAt?: string; tags: string[]; photos: Photo[] }

// Saves an edited review over the old one, at the same record key, so its
// at:// URI (and anything pointing at it) stays the same. swapRecord makes
// it fail, rather than overwrite, if the review changed since it was read.
// The edited record: the edit's fields, and everything else as it was.
export function editedReview(value: ReviewRecord, edit: ReviewEdit): ReviewRecord & { $type: string } {
  const kept: Partial<ReviewRecord> = { ...value };
  delete kept.hikedAt; delete kept.tags; delete kept.photos;
  return {
    ...kept, $type: REVIEW, text: edit.text, createdAt: value.createdAt,
    ...(edit.hikedAt ? { hikedAt: edit.hikedAt } : {}),
    ...(edit.tags.length ? { tags: edit.tags } : {}),
    ...(edit.photos.length ? { photos: edit.photos } : {}),
  };
}

export async function editReview(session: OAuthSession, review: Rec<ReviewRecord>, edit: ReviewEdit): Promise<StrongRef> {
  const rkey = review.uri.split('/').pop()!;
  const record = editedReview(review.value, edit);
  const r = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: REVIEW, rkey, record, swapRecord: review.cid }),
  });
  if (!r.ok) {
    let err: { error?: string; message?: string } = {};
    try { err = await r.json(); } catch { /* no body */ }
    if (err.error === 'InvalidSwap') throw new Error('This review changed since you opened it: reload the page and try again.');
    throw new Error(`Saving failed (${r.status})${err.message ? `: ${err.message}` : ''}`);
  }
  const ref = (await r.json()) as StrongRef;
  notifyIndexer(ref.uri, review.value.routeKey);
  return ref;
}

export async function deletePost(session: OAuthSession, uri: string): Promise<void> {
  const [, , , collection, rkey] = uri.split('/');
  await call(session, 'com.atproto.repo.deleteRecord', { repo: session.did, collection, rkey });
  notifyIndexer(uri);
}

async function getRecord(pds: string, did: string, collection: string, rkey: string): Promise<{ uri: string; cid: string; value: unknown } | null> {
  const u = new URL('/xrpc/com.atproto.repo.getRecord', pds);
  u.searchParams.set('repo', did);
  u.searchParams.set('collection', collection);
  u.searchParams.set('rkey', rkey);
  const r = await fetch(u);
  return r.ok ? await r.json() : null;
}

export interface Rec<T> { uri: string; cid: string; value: T }

// A record by its at:// URI, from the PDS given (the author's): null if it's
// gone, unreadable or not a record URI.
export async function getRecordByUri(pds: string, uri: string): Promise<Rec<unknown> | null> {
  const at = parseAtUri(uri);
  if (!at) return null;
  try {
    return await getRecord(pds, at.repo, at.collection, at.rkey) as Rec<unknown> | null;
  } catch {
    return null;
  }
}

// A collection's records, newest first (TIDs sort by time): up to max.
export async function listRecords<T>(pds: string, did: string, collection: string, max = 200): Promise<Rec<T>[]> {
  const out: Rec<T>[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const u = new URL('/xrpc/com.atproto.repo.listRecords', pds);
    u.searchParams.set('repo', did);
    u.searchParams.set('collection', collection);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u);
    if (!r.ok) break;
    const j = await r.json() as { records: Rec<T>[]; cursor?: string };
    out.push(...j.records);
    if (!j.cursor || j.records.length < 100) break;
    cursor = j.cursor;
  }
  return out.slice(0, max);
}

export interface TrackRecord {
  gpx: BlobRef; createdAt: string; startedAt?: string; duration?: number; distance?: number; gain?: number;
  title?: string; routeKey?: string; photos?: Photo[]; license?: string;
}
export interface ReviewRecord {
  text: string; createdAt: string; hikedAt?: string; routeKey?: string; track?: StrongRef;
  tags?: string[]; photos?: Photo[]; license?: string;
}

// A blob's URL on its PDS (public).
export function blobUrl(pds: string, did: string, blob: BlobRef): string {
  const u = new URL('/xrpc/com.atproto.sync.getBlob', pds);
  u.searchParams.set('did', did);
  u.searchParams.set('cid', blob.ref.$link);
  return u.toString();
}
