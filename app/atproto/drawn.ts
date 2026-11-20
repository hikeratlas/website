// A route drawn on the map (RoutePlanner), as the GPX of a track
// (website#198): its line, with the DEM's elevations where they're known,
// and no times, since nobody walked it with a GPS. <src> says where it came
// from, so a reader can tell it from a recording.
import type { LngLat } from '~/routing/graph';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const DRAWN_SOURCE = 'Drawn on Hiker Atlas';

// [lon, lat] points, with each one's elevation (metres) if known.
export function drawnGpx(name: string, coords: LngLat[], elevations?: (number | null)[]): string {
  const pts = coords.map(([lon, lat], i) => {
    const e = elevations?.[i];
    const ele = e != null && Number.isFinite(e) ? `<ele>${Math.round(e * 10) / 10}</ele>` : '';
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${ele}</trkpt>`;
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<gpx version="1.1" creator="Hiker Atlas" xmlns="http://www.topografix.com/GPX/1/1">'
    + `<trk><name>${esc(name)}</name><src>${DRAWN_SOURCE}</src><trkseg>${pts.join('')}</trkseg></trk></gpx>\n`;
}
