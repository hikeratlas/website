// Aerial imagery as a map layer you can switch on (hikeratlas/basemap#172),
// from hosted services, so nothing to mirror. Bottom to top:
//
// - EOX Sentinel-2 cloudless 2016: everywhere, coarse (10 m). Only the 2016
//   edition is CC BY 4.0; later years are non-commercial.
// - Quebec's "Imagerie orthorectifiée du Québec" (CC BY 4.0).
// - Ontario's imagery web map service (Open Government Licence – Ontario).
// - Saskatchewan's SGIC orthophotos ("for background image services on
//   public websites").
// - USGS The National Map orthoimagery: the US (no use restrictions).
//
// BC and Alberta have no open imagery service (BC's is "access only");
// there, and in the other provinces, EOX is what shows.
//
// While it's on, the map's fills (land cover, water, parks) and hillshade are
// hidden: the imagery stands in for them. Lines and labels (trails, roads,
// park edges, contours, names) stay on top.
import * as maplibregl from 'maplibre-gl';
import type { IControl, Map as MaplibreMap, RasterSourceSpecification } from 'maplibre-gl';

const KEY = 'hikeratlas.imagery';
const HIDDEN = ['fill', 'fill-extrusion', 'hillshade'];

// Some services answer outside their coverage with tiles that would cover
// the sources underneath, so imagery:// fetches those and clears that part:
// - USGS: pure white outside the US (and on the outside part of border
//   tiles): made transparent.
// - Quebec: a very coarse fill outside Quebec, which would cover New
//   Brunswick, Labrador and Ontario: clipped to Quebec's outline
//   (public/imagery/qc-mask.json: OSM's boundary, relation 61549 from
//   Nominatim, simplified to about 1 km; 14 KB gzipped, loaded only when
//   the imagery is on and Quebec is in view).
const UPSTREAM: Record<string, { url: string; clear: 'white' | 'mask'; mask?: string }> = {
  usgs: { url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', clear: 'white' },
  qc: { url: 'https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg', clear: 'mask', mask: '/imagery/qc-mask.json' },
};

// A province's outline: rings of [lon, lat], loaded once.
const masks = new Map<string, Promise<[number, number][][]>>();
function mask(url: string) {
  if (!masks.has(url)) masks.set(url, fetch(url).then((r) => r.json()));
  return masks.get(url)!;
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
    const [service, z, y, x] = params.url.slice('imagery://'.length).split('/');
    const up = UPSTREAM[service];
    const r = await fetch(up.url.replace('{z}', z).replace('{y}', y).replace('{x}', x), { signal: abort.signal });
    if (r.status === 404) return { data: await emptyTile() };
    if (!r.ok) throw new Error(`${r.status} fetching ${params.url}`);
    const img = await createImageBitmap(await r.blob());
    const size = img.width;
    const c = new OffscreenCanvas(size, size);
    const ctx = c.getContext('2d')!;
    if (up.clear === 'mask') {
      // Keep only what's inside the province's outline.
      const rings = await mask(up.mask!);
      const n = 2 ** +z;
      const path = new Path2D();
      for (const ring of rings) {
        ring.forEach(([lon, lat], k) => {
          const px = ((lon + 180) / 360 * n - +x) * size;
          const py = ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n - +y) * size;
          if (k === 0) path.moveTo(px, py); else path.lineTo(px, py);
        });
        path.closePath();
      }
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(img, 0, 0);
      return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
    }
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, size, size);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) d[i + 3] = 0;
    }
    ctx.putImageData(px, 0, 0);
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

type Box = [number, number, number, number];
const SOURCES: [string, RasterSourceSpecification][] = [
  ['imagery-s2', {
    type: 'raster',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    maxzoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
  }],
  ['imagery-qc', {
    type: 'raster',
    tiles: ['imagery://qc/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 18,
    bounds: [-79.8, 44.9, -57.0, 62.7] as Box,
    attribution: 'Imagerie : Gouvernement du Québec (CC BY 4.0)',
  }],
  ['imagery-on', {
    type: 'raster',
    // 404 outside Ontario: nothing drawn.
    tiles: ['https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 18,
    bounds: [-95.2, 41.6, -74.3, 56.9] as Box,
    attribution: 'Imagery: contains information licensed under the Open Government Licence – Ontario',
  }],
  ['imagery-sk', {
    type: 'raster',
    // Rendered per tile (no cache); transparent outside Saskatchewan.
    tiles: ['https://gis.saskatchewan.ca/imagery/rest/services/SGIC_Public_Orthophotos/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image'],
    tileSize: 256,
    maxzoom: 18,
    bounds: [-110.1, 48.9, -101.3, 60.1] as Box,
    attribution: 'Imagery: Saskatchewan Geospatial Imagery Collaborative (SGIC)',
  }],
  ['imagery-usgs', {
    type: 'raster',
    tiles: ['imagery://usgs/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 16,
    // The US and its territories, roughly: no requests for tiles far outside.
    bounds: [-180, 13, -64, 72] as Box,
    attribution: 'Imagery: USDA, USGS The National Map',
  }],
];
const LAYERS = SOURCES.map(([id]) => id);

function show(map: MaplibreMap, on: boolean) {
  const style = map.getStyle();
  for (const l of style.layers) {
    if (HIDDEN.includes(l.type)) map.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible');
  }
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
