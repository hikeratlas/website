import { describe, expect, it } from 'vitest';
import { googleMapsUrl, osmUrl } from './OsmLink';

describe('links to the same view elsewhere', () => {
  it('OpenStreetMap: one zoom level higher, at most 19', () => {
    expect(osmUrl(-78.6266, 45.76818, 9.4)).toBe('https://www.openstreetmap.org/#map=10/45.76818/-78.62660');
    expect(osmUrl(0, 0, 21)).toBe('https://www.openstreetmap.org/#map=19/0.00000/0.00000');
  });

  it('Google Maps (#172): its Maps URLs, terrain, one zoom level higher, at most 21', () => {
    expect(googleMapsUrl(-78.6266, 45.76818, 9.4))
      .toBe('https://www.google.com/maps/@?api=1&map_action=map&center=45.76818,-78.62660&zoom=10&basemap=terrain');
    expect(googleMapsUrl(0, 0, 22)).toContain('&zoom=21&');
    expect(googleMapsUrl(0, 0, -3)).toContain('&zoom=0&');
  });
});
