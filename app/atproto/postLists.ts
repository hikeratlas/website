// How reviews and tracks are listed and deleted (website#158). A review
// points at its track by strongRef; a track doesn't point back. Every track
// is listed, whether it was posted alone or with a review, and a review
// shows its track too. A review and its track were posted together, so
// deleting either deletes both.
//
// Plain functions, so they can be tested without React.
import type { Rec, ReviewRecord, TrackRecord } from './posts';

export interface ReviewItem { at: string; review: Rec<ReviewRecord>; track?: Rec<TrackRecord> }
export interface TrackItem { at: string; track: Rec<TrackRecord> }

// A profile's two lists, newest hike first: every review (with its track,
// if that's among the loaded tracks), and every track.
export function profileLists(reviews: Rec<ReviewRecord>[], tracks: Rec<TrackRecord>[]): { reviews: ReviewItem[]; tracks: TrackItem[] } {
  const newest = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);
  return {
    reviews: reviews.map((review) => {
      const track = findTrack(review.value.track?.uri, tracks);
      return { at: review.value.hikedAt ?? track?.value.startedAt ?? review.value.createdAt, review, track };
    }).sort(newest),
    tracks: tracks.map((track) => ({ at: track.value.startedAt ?? track.value.createdAt, track })).sort(newest),
  };
}

// The track a strongRef's URI names, if it's among those given.
export function findTrack<T extends { uri: string }>(uri: string | undefined, tracks: T[]): T | undefined {
  return uri ? tracks.find((t) => t.uri === uri) : undefined;
}

// What a Delete removes, in order, and how the confirmation says so. Only
// loaded records, which are all the author's own: a strongRef could name a
// record in someone else's repository, and deleteRecord takes just the
// collection and rkey, so deleting by the ref alone could hit a different
// record of yours.
export function deleteTargets(
  what: { review: Rec<ReviewRecord> } | { track: Rec<TrackRecord> },
  reviews: Rec<ReviewRecord>[], tracks: Rec<TrackRecord>[],
): { uris: string[]; confirm: string } {
  if ('review' in what) {
    const track = findTrack(what.review.value.track?.uri, tracks);
    return track
      ? { uris: [what.review.uri, track.uri], confirm: 'Deleting this review also deletes its track.' }
      : { uris: [what.review.uri], confirm: 'Delete this review?' };
  }
  // Reviews first: none is left pointing at a track that's gone.
  const pointing = reviews.filter((r) => r.value.track?.uri === what.track.uri);
  return pointing.length
    ? { uris: [...pointing.map((r) => r.uri), what.track.uri], confirm: 'Deleting this track also deletes its review.' }
    : { uris: [what.track.uri], confirm: 'Delete this track?' };
}

// A record's at:// URI as its parts, or null if it isn't one.
export function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  return m ? { repo: m[1], collection: m[2], rkey: m[3] } : null;
}

// Whether a track record has what showing it needs: these are other
// people's records.
export const isTrack = (v: unknown): v is TrackRecord => {
  const t = v as Partial<TrackRecord> | null;
  return !!t && typeof t.createdAt === 'string' && typeof t.gpx?.ref?.$link === 'string';
};

// A list with more added, without repeating any already in it (by URI): a
// hike sheet's Tracks can have one added out of turn (a review's track), and
// the next page may bring it again.
export function addNew<T extends { uri: string }>(list: T[], more: T[]): T[] {
  const have = new Set(list.map((x) => x.uri));
  return [...list, ...more.filter((x) => !have.has(x.uri) && have.add(x.uri))];
}
