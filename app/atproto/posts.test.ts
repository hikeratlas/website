import { describe, expect, it } from 'vitest';
import { editedReview, type ReviewRecord } from './posts';

const blob = (cid: string) => ({ $type: 'blob' as const, ref: { $link: cid }, mimeType: 'image/jpeg', size: 1 });
const review: ReviewRecord = {
  text: 'Muddy', createdAt: '2026-11-01T10:00:00.000Z', hikedAt: '2026-10-31T16:00:00.000Z', license: 'CC-BY-4.0',
  routeKey: '1E57E06gbDEBBBICDGF.tn3dBnAuR_Q', track: { uri: 'at://did:plc:x/com.hikeratlas.temp.track/3l', cid: 'bafy' },
  tags: ['mud'], photos: [{ image: blob('a'), alt: 'one' }, { image: blob('b') }],
};

describe('editedReview', () => {
  it('changes only what the edit says', () => {
    const out = editedReview(review, { text: 'Muddy, then snow', hikedAt: '2026-10-30T16:00:00.000Z', tags: ['mud', 'snow'], photos: [{ image: blob('b'), alt: 'two' }] });
    expect(out).toEqual({
      $type: 'com.hikeratlas.temp.review', text: 'Muddy, then snow', createdAt: review.createdAt, hikedAt: '2026-10-30T16:00:00.000Z',
      license: 'CC-BY-4.0', routeKey: review.routeKey, track: review.track, tags: ['mud', 'snow'], photos: [{ image: blob('b'), alt: 'two' }],
    });
  });

  it('drops tags, photos and the date when the edit removes them', () => {
    const out = editedReview(review, { text: 'x', tags: [], photos: [] });
    expect(out).not.toHaveProperty('tags');
    expect(out).not.toHaveProperty('photos');
    expect(out).not.toHaveProperty('hikedAt');
    expect(out.license).toBe('CC-BY-4.0');
  });

  it('changes the licence when the edit gives one', () => {
    expect(editedReview(review, { text: 'x', tags: [], photos: [], license: 'CC0-1.0' }).license).toBe('CC0-1.0');
    const unlicensed: ReviewRecord = { ...review };
    delete unlicensed.license;
    const none = editedReview(unlicensed, { text: 'x', tags: [], photos: [] });
    expect(none).not.toHaveProperty('license');
  });
});
