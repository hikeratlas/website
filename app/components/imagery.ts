// Aerial imagery as a map layer you can switch on (hikeratlas/basemap#172),
// from hosted services, so nothing to mirror:
//
// - USGS The National Map orthoimagery (NAIP-based, US only): free, no key,
//   and "no use restrictions" on its map services.
// - EOX Sentinel-2 cloudless 2016 underneath, as a coarse (10 m) fallback
//   elsewhere, e.g. Canada. Only the 2016 edition is CC BY 4.0; later years
//   are non-commercial.
//
// While it's on, the map's fills (land cover, water, parks) and hillshade are
// hidden: the imagery stands in for them. Lines and labels (trails, roads,
// park edges, contours, names) stay on top.
import * as maplibregl from 'maplibre-gl';
import type { IControl, Map as MaplibreMap } from 'maplibre-gl';

const KEY = 'hikeratlas.imagery';
const LAYERS = ['imagery-s2', 'imagery-usgs'];
const HIDDEN = ['fill', 'fill-extrusion', 'hillshade'];

// USGS's tile service answers pure white for tiles outside the US (Canada,
// say), and for the parts of border tiles outside it, which would cover the
// EOX imagery underneath. usgs:// fetches its tiles and makes pure white
// transparent.
const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/';
let registered = false;
function registerUsgs() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('usgs', async (params, abort) => {
    const r = await fetch(USGS + params.url.slice('usgs://'.length), { signal: abort.signal });
    if (!r.ok) throw new Error(`${r.status} fetching ${params.url}`);
    const img = await createImageBitmap(await r.blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) d[i + 3] = 0;
    }
    ctx.putImageData(px, 0, 0);
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

const SOURCES = {
  'imagery-s2': {
    type: 'raster' as const,
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    maxzoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
  },
  'imagery-usgs': {
    type: 'raster' as const,
    tiles: ['usgs://{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 16,
    // The US and its territories, roughly: no requests for tiles far outside.
    bounds: [-180, 13, -64, 72] as [number, number, number, number],
    attribution: 'Imagery: USDA, USGS The National Map',
  },
};

function show(map: MaplibreMap, on: boolean) {
  const style = map.getStyle();
  for (const l of style.layers) {
    if (HIDDEN.includes(l.type)) map.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible');
  }
  if (!on) {
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    return;
  }
  // Just above the background.
  const above = style.layers.find((l) => l.type !== 'background' && !LAYERS.includes(l.id))?.id;
  for (const id of LAYERS) {
    if (!map.getSource(id)) map.addSource(id, SOURCES[id as keyof typeof SOURCES]);
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
    if (m && this.on && m.isStyleLoaded() && !m.getLayer(LAYERS[1])) show(m, true);
  };

  onAdd(map: MaplibreMap): HTMLElement {
    registerUsgs();
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
