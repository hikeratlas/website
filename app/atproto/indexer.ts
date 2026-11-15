// Hiker Atlas's indexer (hikeratlas/atproto-indexer): everyone's faves,
// reviews and tracks, by route key, so hike pages can show more than your
// own. Its queries are lexicons in hikeratlas/atproto-lexicon. Every call
// gives up quickly and returns null: a page without them is the page as it
// was before.
//
// After each write, the site tells the indexer (notifyIndexer), so people
// see their own posts at once rather than after its next Jetstream run
// (atproto-indexer#15); the sheets showing that route then refetch, past
// the indexer's cache.
import { useEffect, useState } from 'react';
import type { ReviewRecord, TrackRecord } from './posts';

export const INDEXER = 'https://indexer.hikeratlas.com';
const TIMEOUT_MS = 5000;

export interface RouteStats {
  routeKey: string; faves: number; reviews: number; tracks: number;
  lastActivity?: string; recentTags?: string[];
}
export interface ActorView { did: string; handle?: string; pds?: string }
export interface PostView<T> { uri: string; cid: string; author: ActorView; record: T; indexedAt: string }

// fresh: non-zero after one of our writes, to get past the indexer's cache.
async function query<T>(nsid: string, params: [string, string][], fresh = 0): Promise<T | null> {
  const u = new URL(`/xrpc/${nsid}`, INDEXER);
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (fresh) u.searchParams.set('fresh', String(fresh));
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function getRouteStats(keys: string[], fresh = 0): Promise<Map<string, RouteStats> | null> {
  if (!keys.length) return new Map();
  const r = await query<{ routes: RouteStats[] }>('com.hikeratlas.temp.getRouteStats', keys.slice(0, 100).map((k) => ['keys', k]), fresh);
  return r ? new Map(r.routes.map((s) => [s.routeKey, s])) : null;
}

export async function getRouteReviews(key: string, limit: number, cursor?: string, fresh = 0) {
  return query<{ reviews: PostView<ReviewRecord>[]; cursor?: string }>('com.hikeratlas.temp.getRouteReviews',
    [['key', key], ['limit', String(limit)], ...(cursor ? [['cursor', cursor] as [string, string]] : [])], fresh);
}

export async function getRouteTracks(key: string, limit: number, cursor?: string, fresh = 0) {
  return query<{ tracks: PostView<TrackRecord>[]; cursor?: string }>('com.hikeratlas.temp.getRouteTracks',
    [['key', key], ['limit', String(limit)], ...(cursor ? [['cursor', cursor] as [string, string]] : [])], fresh);
}

const INDEXED = 'hikeratlas:indexed';

// Tells the indexer about a record just written or deleted (its at:// URI),
// then the sheets showing its route (or all, without one) refetch. Never
// throws or blocks the write: without the indexer, the record arrives
// through Jetstream as before.
export function notifyIndexer(uri: string, routeKey?: string): void {
  fetch(new URL('/notify', INDEXER), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {}).finally(() => {
    window.dispatchEvent(new CustomEvent(INDEXED, { detail: { routeKey } }));
  });
}

// Bumps after one of our writes to this route is indexed: a dependency that
// refetches, and the fresh value that gets past the indexer's cache.
export function useFresh(key: string | null): number {
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<{ routeKey?: string }>).detail?.routeKey;
      if (!k || k === key) setFresh(Date.now());
    };
    window.addEventListener(INDEXED, on);
    return () => window.removeEventListener(INDEXED, on);
  }, [key]);
  return fresh;
}

// A post's "Report" link: hikeratlas/feedback's report form, with the
// record's at:// URI filled in.
export function reportUrl(uri: string): string {
  const u = new URL('https://github.com/hikeratlas/feedback/issues/new');
  u.searchParams.set('template', 'report.yml');
  u.searchParams.set('link', uri);
  return u.toString();
}
