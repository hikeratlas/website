// The map's own elevations in the reader's units (units.ts): its contours
// and the labels that print an elevation (the basemap style's, which are
// metric: "1,200 m"). Done here, at display time, not in the style: the
// style stays generic. In feet, the contours are drawn at round heights in
// feet (maplibre-contour's multiplier, with foot intervals), and labels
// ending " m" end " ft", their value converted.
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { Units } from '~/units';

const FT_PER_M = 3.28084;
// Intervals in feet, as the style's in metres (zoom*minor*major): 11*100*500
// ~12*50*200~13*20*100~14*10*50 m become about the same spacing in feet.
const FT_THRESHOLDS = '11*500*2500~12*200*1000~13*100*500~14*50*250';

// The style as loaded, to go back to metric from: per map, its contours'
// tiles URL and each elevation label's text-field.
const originals = new WeakMap<MaplibreMap, { tiles: string[] | null; fields: Map<string, unknown> }>();

// An expression with its " m" ends made " ft", and the elevations under
// them converted (unless the data is already in feet: the contours').
function toFeet(e: unknown, convert: boolean): unknown {
  if (!Array.isArray(e)) return e;
  if (e[0] === 'concat' && e[e.length - 1] === ' m') {
    const body = e.slice(1, -1).map((x) => (convert ? withFeet(x) : x));
    return ['concat', ...body, ' ft'];
  }
  return e.map((x) => toFeet(x, convert));
}

// ["get", "ele"] made feet, within a label's value.
function withFeet(e: unknown): unknown {
  if (!Array.isArray(e)) return e;
  if (e[0] === 'get' && e[1] === 'ele') return ['*', ['to-number', e], FT_PER_M];
  return e.map(withFeet);
}

const hasMetres = (e: unknown): boolean =>
  Array.isArray(e) && ((e[0] === 'concat' && e[e.length - 1] === ' m') || e.some(hasMetres));

// A new style loaded (setStyle): its labels are the ones to start from.
export function forgetMapStyle(map: MaplibreMap) {
  originals.delete(map);
}

export function applyMapUnits(map: MaplibreMap, u: Units) {
  const style = map.getStyle();
  if (!style?.layers) return;
  let o = originals.get(map);
  if (!o) {
    const src = style.sources?.contours as { tiles?: string[] } | undefined;
    o = { tiles: src?.tiles ?? null, fields: new Map() };
    for (const l of style.layers) {
      const tf = (l as { layout?: { 'text-field'?: unknown } }).layout?.['text-field'];
      if (hasMetres(tf)) o.fields.set(l.id, tf);
    }
    originals.set(map, o);
  }
  const feet = u.elevation === 'ft';
  for (const [id, tf] of o.fields) {
    if (!map.getLayer(id)) continue;
    const isContour = (map.getLayer(id) as { source?: string }).source === 'contours';
    map.setLayoutProperty(id, 'text-field', (feet ? toFeet(tf, !isContour) : tf) as never);
  }
  const src = map.getSource('contours') as { setTiles?: (t: string[]) => void } | undefined;
  if (o.tiles && src?.setTiles) {
    src.setTiles(feet
      ? o.tiles.map((t) => t.replace(/thresholds=[^&]*/, `thresholds=${FT_THRESHOLDS}`) + `&multiplier=${FT_PER_M}`)
      : o.tiles);
  }
}
