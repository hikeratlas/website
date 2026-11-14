// Hiker Atlas's indexer (hikeratlas/atproto-indexer): everyone's faves,
// reviews and tracks, by route key, so hike pages can show more than your
// own. Its queries are lexicons in hikeratlas/atproto-lexicon. Every call
// gives up quickly and returns null: a page without them is the page as it
// was before.
import type { ReviewRecord, TrackRecord } from './posts';

export const INDEXER = 'https://indexer.hikeratlas.com';
const TIMEOUT_MS = 5000;

export interface RouteStats {
  routeKey: string; faves: number; reviews: number; tracks: number;
  lastActivity?: string; recentTags?: string[];
}
export interface ActorView { did: string; handle?: string; pds?: string }
export interface PostView<T> { uri: string; cid: string; author: ActorView; record: T; indexedAt: string }

async function query<T>(nsid: string, params: [string, string][]): Promise<T | null> {
  const u = new URL(`/xrpc/${nsid}`, INDEXER);
  for (const [k, v] of params) u.searchParams.append(k, v);
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function getRouteStats(keys: string[]): Promise<Map<string, RouteStats> | null> {
  if (!keys.length) return new Map();
  const r = await query<{ routes: RouteStats[] }>('com.hikeratlas.temp.getRouteStats', keys.slice(0, 100).map((k) => ['keys', k]));
  return r ? new Map(r.routes.map((s) => [s.routeKey, s])) : null;
}

export async function getRouteReviews(key: string, limit: number, cursor?: string) {
  return query<{ reviews: PostView<ReviewRecord>[]; cursor?: string }>('com.hikeratlas.temp.getRouteReviews',
    [['key', key], ['limit', String(limit)], ...(cursor ? [['cursor', cursor] as [string, string]] : [])]);
}

export async function getRouteTracks(key: string, limit: number, cursor?: string) {
  return query<{ tracks: PostView<TrackRecord>[]; cursor?: string }>('com.hikeratlas.temp.getRouteTracks',
    [['key', key], ['limit', String(limit)], ...(cursor ? [['cursor', cursor] as [string, string]] : [])]);
}

// A post's "Report" link: hikeratlas/feedback's report form, with the
// record's at:// URI filled in.
export function reportUrl(uri: string): string {
  const u = new URL('https://github.com/hikeratlas/feedback/issues/new');
  u.searchParams.set('template', 'report.yml');
  u.searchParams.set('link', uri);
  return u.toString();
}
