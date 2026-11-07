// Aerial imagery as a map layer you can switch on (hikeratlas/basemap#172),
// from hosted services, so nothing to mirror. Bottom to top:
//
// - EOX Sentinel-2 cloudless 2025: everywhere, coarse (10 m). CC BY-NC-SA
//   4.0, free for non-commercial use with attribution: Hiker Atlas is
//   non-commercial and open source. 2025 shows e.g. Jasper's 2024 burn. If
//   that ever changes, the 2016 edition (s2cloudless_3857) is CC BY 4.0.
// - Quebec's "Imagerie orthorectifiée du Québec" (CC BY 4.0).
// - Ontario's imagery web map service (Open Government Licence – Ontario).
// - Saskatchewan's SGIC orthophotos ("for background image services on
//   public websites").
// - USGS The National Map orthoimagery: the US (no use restrictions).
//
// BC and Alberta have no open imagery service (BC's is "access only");
// there, and in the other provinces, EOX is what shows.
//
// Every tile goes through the imagery:// protocol, which first checks the
// tile against the service's coverage (an outline in public/imagery/, from
// OSM's boundaries via Nominatim, simplified), so a view asks each service
// only for tiles it can fill: no USGS requests in Canada, no Ontario ones in
// Michigan, no EOX ones deep inside the US (where USGS covers it). Then:
// - USGS: outside the US, white, or blurry coarse imagery (north of Maine):
//   clipped to the US outline (us-cover.json, about 5 km outward), and pure
//   white made transparent for that margin.
// - Quebec: a very coarse fill outside Quebec, which would cover New
//   Brunswick, Labrador and Ontario: clipped to Quebec's outline
//   (qc-mask.json, simplified to about 1 km).
//
// While it's on, the map's fills (land cover, water, parks) and hillshade are
// hidden: the imagery stands in for them. Lines and labels (trails, roads,
// park edges, contours, names) stay on top, restyled for a dark, busy
// background (imageryPaint, basemap#176).
import * as maplibregl from 'maplibre-gl';
import type { IControl, LayerSpecification, Map as MaplibreMap, RasterSourceSpecification } from 'maplibre-gl';

const KEY = 'hikeratlas.imagery';
const HIDDEN = ['fill', 'fill-extrusion', 'hillshade'];

type Ring = [number, number][];
type Box = [number, number, number, number]; // w, s, e, n

interface Service {
  // {z}/{y}/{x}, or {bbox} (Web Mercator metres) for an export endpoint.
  url: string;
  // Fetch only tiles touching this outline.
  cover?: string;
  // Skip tiles entirely inside this outline (something above covers them).
  skipInside?: string;
  // Clip to the cover outline (the service draws something outside it).
  mask?: boolean;
  // Make pure white transparent (the service's "no imagery").
  white?: boolean;
}

const SERVICES: Record<string, Service> = {
  s2: {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    // 25 km inside the US's outline (which includes its territorial sea),
    // so USGS fills everything EOX skips.
    skipInside: '/imagery/us-inside.json',
  },
  qc: {
    url: 'https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg',
    cover: '/imagery/qc-mask.json',
    mask: true,
  },
  on: {
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}',
    cover: '/imagery/on-cover.json',
  },
  sk: {
    // Rendered per tile (no cache); transparent outside Saskatchewan.
    url: 'https://gis.saskatchewan.ca/imagery/rest/services/SGIC_Public_Orthophotos/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image',
    cover: '/imagery/sk-cover.json',
  },
  usgs: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    cover: '/imagery/us-cover.json',
    mask: true,
    white: true,
  },
};

// Outlines: rings of [lon, lat], each with its bounding box, loaded once.
interface Outline { rings: Ring[]; boxes: Box[] }
const outlines = new Map<string, Promise<Outline>>();
function outline(url: string): Promise<Outline> {
  if (!outlines.has(url)) {
    outlines.set(url, fetch(url).then((r) => r.json() as Promise<Ring[]>).then((rings) => ({
      rings,
      boxes: rings.map((r) => [
        Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])),
        Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1])),
      ] as Box),
    })));
  }
  return outlines.get(url)!;
}

function tileBox(z: number, x: number, y: number): Box {
  const n = 2 ** z;
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

function overlaps(a: Box, b: Box) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function inRings(o: Outline, lon: number, lat: number) {
  let inside = false;
  o.rings.forEach((r, k) => {
    const b = o.boxes[k];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

// Whether any outline edge crosses the box (or lies in it).
function edgeIn(o: Outline, t: Box) {
  const [w, s, e, n] = t;
  const hit = (ax: number, ay: number, bx: number, by: number) => {
    // Liang-Barsky clip of segment a-b against the box.
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    for (const [p, q] of [[-dx, ax - w], [dx, e - ax], [-dy, ay - s], [dy, n - ay]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  };
  return o.rings.some((r, k) => overlaps(o.boxes[k], t) && r.some((p, i) => i > 0 && hit(r[i - 1][0], r[i - 1][1], p[0], p[1])));
}

const corners = (t: Box): [number, number][] => [[t[0], t[1]], [t[2], t[1]], [t[0], t[3]], [t[2], t[3]]];

function touches(o: Outline, t: Box) {
  if (!o.boxes.some((b) => overlaps(b, t))) return false;
  return corners(t).some(([lon, lat]) => inRings(o, lon, lat)) || edgeIn(o, t);
}

function within(o: Outline, t: Box) {
  return corners(t).every(([lon, lat]) => inRings(o, lon, lat)) && !edgeIn(o, t);
}

let empty: ArrayBuffer | undefined;
async function emptyTile(): Promise<ArrayBuffer> {
  if (!empty) empty = await (await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' })).arrayBuffer();
  return empty;
}

let registered = false;
function registerProtocol() {
  if (registered) return;
  registered = true;
  // imagery://<service>/<z>/<y>/<x>
  maplibregl.addProtocol('imagery', async (params, abort) => {
    const [service, zs, ys, xs] = params.url.slice('imagery://'.length).split('/');
    const sv = SERVICES[service];
    const z = +zs, y = +ys, x = +xs;
    const t = tileBox(z, x, y);
    if (sv.cover && !touches(await outline(sv.cover), t)) return { data: await emptyTile() };
    if (sv.skipInside && within(await outline(sv.skipInside), t)) return { data: await emptyTile() };

    const half = 20037508.342789244, size = (2 * half) / 2 ** z;
    const bbox = [x * size - half, half - (y + 1) * size, (x + 1) * size - half, half - y * size].join(',');
    const url = sv.url.replace('{z}', zs).replace('{y}', ys).replace('{x}', xs).replace('{bbox}', bbox);
    const r = await fetch(url, { signal: abort.signal });
    if (r.status === 404) return { data: await emptyTile() };
    if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
    if (!sv.mask && !sv.white) return { data: await r.arrayBuffer() };

    const img = await createImageBitmap(await r.blob());
    const px = img.width;
    const c = new OffscreenCanvas(px, px);
    const ctx = c.getContext('2d')!;
    if (sv.mask) {
      // Keep only what's inside the outline.
      const { rings } = await outline(sv.cover!);
      const n = 2 ** z;
      const path = new Path2D();
      for (const ring of rings) {
        ring.forEach(([lon, lat], k) => {
          const mx = ((lon + 180) / 360 * n - x) * px;
          const my = ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n - y) * px;
          if (k === 0) path.moveTo(mx, my); else path.lineTo(mx, my);
        });
        path.closePath();
      }
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-in';
    }
    ctx.drawImage(img, 0, 0);
    if (sv.white) {
      const data = ctx.getImageData(0, 0, px, px);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) d[i + 3] = 0;
      }
      ctx.putImageData(data, 0, 0);
    }
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

const source = (service: string, maxzoom: number, attribution: string, bounds?: Box): RasterSourceSpecification => ({
  type: 'raster',
  tiles: [`imagery://${service}/{z}/{y}/{x}`],
  tileSize: 256,
  maxzoom,
  attribution,
  ...(bounds ? { bounds } : {}),
});

const SOURCES: [string, RasterSourceSpecification][] = [
  ['imagery-s2', source('s2', 14, '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>')],
  ['imagery-qc', source('qc', 18, 'Imagerie : Gouvernement du Québec (CC BY 4.0)', [-79.8, 44.9, -57.0, 62.7])],
  ['imagery-on', source('on', 18, 'Imagery: contains information licensed under the Open Government Licence – Ontario', [-95.3, 41.6, -74.2, 57.0])],
  ['imagery-sk', source('sk', 18, 'Imagery: Saskatchewan Geospatial Imagery Collaborative (SGIC)', [-110.1, 48.9, -101.3, 60.1])],
  ['imagery-usgs', source('usgs', 16, 'Imagery: USDA, USGS The National Map', [-180, 15, -64, 72])],
];
const LAYERS = SOURCES.map(([id]) => id);

// The basemap's lines and labels are styled for a light map: white forest
// roads, dark red trails, dark labels on pale halos, green park bands, blue
// streams. Over imagery the roads glare, the trails vanish into dark forest
// and the rest is clutter (basemap#176). Over imagery:
// - labels: white (light blue for water) on a dark halo;
// - trails: light, so they show on dark forest; bike trails light orange;
// - roads: translucent, without casings; OSM route bands fainter;
// - streams faint; park edges a thin light green, without the band;
// - contours and boundaries: white or light grey instead of brown.
// Matched by source layer, so new layers of a kind follow along.
type PaintKey = Parameters<MaplibreMap['setPaintProperty']>[1];
type PaintValue = Parameters<MaplibreMap['setPaintProperty']>[2];
type Paint = Partial<Record<PaintKey, PaintValue>>;
function imageryPaint(l: LayerSpecification): Paint | undefined {
  const sl = 'source-layer' in l ? l['source-layer'] : undefined;
  const id = l.id;
  if (l.type === 'symbol') {
    const water = !!sl && (sl.startsWith('water') || sl === 'lake_centerline');
    return {
      'text-color': water ? '#bae6fd' : '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.7)',
      'text-halo-width': 1.5,
      'text-halo-blur': 0.5,
    };
  }
  if (l.type !== 'line') return undefined;
  switch (sl) {
    case 'road':
      return id.includes('casing') ? { 'line-opacity': 0 } : { 'line-opacity': 0.5 };
    case 'path':
      if (id.includes('bridge')) return undefined;
      if (id.includes('closed')) return { 'line-color': '#e4e4e7' };
      if (id.includes('crossings')) return { 'line-color': '#7dd3fc' };
      if (/mtb|bike|cycle/.test(id)) return { 'line-color': '#fdba74', 'line-blur': 0 };
      return { 'line-color': '#fb7185', 'line-blur': 0 };
    case 'route':
      return { 'line-opacity': 0.15 };
    case 'water_line':
      return { 'line-opacity': 0.35 };
    case 'park_outline':
      return id.includes('band') ? { 'line-opacity': 0 } : { 'line-color': '#bbf7d0', 'line-opacity': 0.7 };
    case 'contours-15':
      return { 'line-color': '#ffffff' };
    case 'boundary':
      return { 'line-color': '#e4e4e7' };
  }
  return undefined;
}

// The style's own paint values, to put back when the imagery goes off.
const original = new Map<string, Paint>();

function restyle(map: MaplibreMap, on: boolean) {
  for (const l of map.getStyle().layers) {
    if (on) {
      const paint = imageryPaint(l);
      if (!paint) continue;
      const saved: Paint = original.get(l.id) ?? {};
      for (const [k, v] of Object.entries(paint) as [PaintKey, PaintValue][]) {
        if (!(k in saved)) saved[k] = map.getPaintProperty(l.id, k);
        map.setPaintProperty(l.id, k, v);
      }
      original.set(l.id, saved);
    } else {
      for (const [k, v] of Object.entries(original.get(l.id) ?? {}) as [PaintKey, PaintValue][]) map.setPaintProperty(l.id, k, v);
    }
  }
  if (!on) original.clear();
}

function show(map: MaplibreMap, on: boolean) {
  const style = map.getStyle();
  for (const l of style.layers) {
    if (HIDDEN.includes(l.type)) map.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible');
  }
  restyle(map, on);
  if (!on) {
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    return;
  }
  // Just above the background, in order.
  const above = style.layers.find((l) => l.type !== 'background' && !LAYERS.includes(l.id))?.id;
  for (const [id, spec] of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, spec);
    if (!map.getLayer(id)) map.addLayer({ id, type: 'raster', source: id }, above);
  }
}

function saved(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function save(on: boolean) {
  try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode etc. */ }
}

// A map control: a button that switches the imagery on and off, remembered
// per browser.
export class ImageryControl implements IControl {
  private map?: MaplibreMap;
  private box?: HTMLDivElement;
  private on = saved();
  // A new style (a preview build) drops added layers: put them back.
  private reapply = () => {
    const m = this.map;
    if (m && this.on && m.isStyleLoaded() && !m.getLayer(LAYERS[LAYERS.length - 1])) show(m, true);
  };

  onAdd(map: MaplibreMap): HTMLElement {
    registerProtocol();
    this.map = map;
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'imagery-toggle';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm2 0v9.6l3.3-3.3a1 1 0 0 1 1.4 0l3.8 3.8 2.3-2.3a1 1 0 0 1 1.4 0L19 14.6V5zm11 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>';
    const label = () => {
      b.title = this.on ? 'Hide aerial imagery' : 'Show aerial imagery';
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(this.on));
    };
    label();
    b.addEventListener('click', () => {
      this.on = !this.on;
      save(this.on);
      label();
      show(map, this.on);
    });
    box.appendChild(b);
    this.box = box;
    if (map.isStyleLoaded()) show(map, this.on);
    else map.once('load', () => show(map, this.on));
    map.on('styledata', this.reapply);
    return box;
  }

  onRemove() {
    this.map?.off('styledata', this.reapply);
    this.box?.remove();
    this.map = undefined;
  }
}
