// How a profile lists reviews and tracks, and what a Delete removes
// (website#158).
import { describe, expect, it } from 'vitest';
import type { Rec, ReviewRecord, TrackRecord } from './posts';
import { addNew, deleteTargets, parseAtUri, profileLists } from './postLists';

const DID = 'did:plc:someone';
const uri = (collection: string, rkey: string) => `at://${DID}/com.hikeratlas.temp.${collection}/${rkey}`;
const blob = { $type: 'blob' as const, ref: { $link: 'bafy' }, mimeType: 'application/gzip', size: 1 };

const track = (rkey: string, startedAt: string): Rec<TrackRecord> =>
  ({ uri: uri('track', rkey), cid: `cid-${rkey}`, value: { gpx: blob, createdAt: startedAt, startedAt } });
const review = (rkey: string, hikedAt: string, of?: Rec<TrackRecord> | string): Rec<ReviewRecord> => ({
  uri: uri('review', rkey), cid: `cid-${rkey}`,
  value: {
    text: rkey, createdAt: hikedAt, hikedAt,
    ...(of ? { track: typeof of === 'string' ? { uri: of, cid: 'gone' } : { uri: of.uri, cid: of.cid } } : {}),
  },
});

// A track posted alone, a review with its track, a review without a track,
// and a review whose track is gone.
const alone = track('t1', '2026-07-01');
const withReview = track('t2', '2026-08-01');
const reviewed = review('r1', '2026-08-01', withReview);
const plain = review('r2', '2026-06-01');
const orphan = review('r3', '2026-09-01', uri('track', 'deleted'));
const tracks = [alone, withReview];
const reviews = [reviewed, plain, orphan];

describe('a profile’s lists', () => {
  const lists = profileLists(reviews, tracks);

  it('lists every track, posted alone or with a review', () => {
    expect(lists.tracks.map((t) => t.track.uri)).toEqual([withReview.uri, alone.uri]);
  });

  it('lists every review, newest hike first', () => {
    expect(lists.reviews.map((r) => r.review.uri)).toEqual([orphan.uri, reviewed.uri, plain.uri]);
  });

  it('gives a review its track, and none when it has none or it’s gone', () => {
    const of = new Map(lists.reviews.map((r) => [r.review.uri, r.track?.uri]));
    expect(of.get(reviewed.uri)).toBe(withReview.uri);
    expect(of.get(plain.uri)).toBeUndefined();
    expect(of.get(orphan.uri)).toBeUndefined();
  });

  it('dates a review without hikedAt by its track', () => {
    const r: Rec<ReviewRecord> = { ...reviewed, value: { ...reviewed.value, hikedAt: undefined, createdAt: '2026-10-01' } };
    expect(profileLists([r], tracks).reviews[0].at).toBe('2026-08-01');
  });
});

describe('deleting', () => {
  it('deletes a review and its track', () => {
    expect(deleteTargets({ review: reviewed }, reviews, tracks)).toEqual({
      uris: [reviewed.uri, withReview.uri], confirm: 'Deleting this review also deletes its track.',
    });
  });

  it('deletes a track and its review', () => {
    expect(deleteTargets({ track: withReview }, reviews, tracks)).toEqual({
      uris: [reviewed.uri, withReview.uri], confirm: 'Deleting this track also deletes its review.',
    });
  });

  it('deletes a review alone', () => {
    expect(deleteTargets({ review: plain }, reviews, tracks)).toEqual({ uris: [plain.uri], confirm: 'Delete this review?' });
  });

  it('deletes a track alone', () => {
    expect(deleteTargets({ track: alone }, reviews, tracks)).toEqual({ uris: [alone.uri], confirm: 'Delete this track?' });
  });

  // Deleting by the ref alone could delete a different record: deleteRecord
  // takes only the collection and rkey, in your own repository.
  it('deletes only the review when its track isn’t loaded', () => {
    expect(deleteTargets({ review: orphan }, reviews, tracks)).toEqual({ uris: [orphan.uri], confirm: 'Delete this review?' });
  });
});

describe('helpers', () => {
  it('reads an at:// URI', () => {
    expect(parseAtUri(alone.uri)).toEqual({ repo: DID, collection: 'com.hikeratlas.temp.track', rkey: 't1' });
    expect(parseAtUri('https://example.com/x')).toBeNull();
  });

  it('adds to a list without repeating what’s in it', () => {
    const a = { uri: 'a' }, b = { uri: 'b' }, c = { uri: 'c' };
    expect(addNew([a, b], [b, c, c])).toEqual([a, b, c]);
  });
});
