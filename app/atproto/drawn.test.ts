import { describe, expect, it } from 'vitest';
import { drawnGpx, DRAWN_SOURCE } from './drawn';

describe('a drawn route as GPX', () => {
  it('has its points in order, with elevations where known, and no times', () => {
    const g = drawnGpx('Loop', [[-80.5, 43.46], [-80.51, 43.47], [-80.52, 43.48]], [320.04, null, 331]);
    expect(g).toContain('<trkpt lat="43.460000" lon="-80.500000"><ele>320</ele></trkpt><trkpt lat="43.470000" lon="-80.510000"></trkpt><trkpt lat="43.480000" lon="-80.520000"><ele>331</ele></trkpt>');
    expect(g).not.toContain('<time>');
  });

  it('says it was drawn, and escapes its name', () => {
    const g = drawnGpx('Tom & Jerry <loop>', [[0, 0], [0.001, 0]]);
    expect(g).toContain('<name>Tom &amp; Jerry &lt;loop&gt;</name>');
    expect(g).toContain(`<src>${DRAWN_SOURCE}</src>`);
  });
});
