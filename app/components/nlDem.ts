// Newfoundland's 5 m DEM (hikeratlas/nl-dem, basemap#181) in place of
// Mapterhorn's tiles over the island. Mapterhorn only has 30 m data there,
// and its z14+ tiles are blurrier than its own z13. nl-dem publishes
// Terrarium tiles on Mapterhorn's grid, z10-z13, for the island only; each
// is complete (filled from Mapterhorn at the coast), so a tile from either
// source stitches with its neighbours.
//
// The basemap style keeps pointing at Mapterhorn. demTransformRequest()
// rewrites those tile URLs to the nldem:// protocol, which serves:
// - z10-z13: nl-dem's tile if the archive has one, else Mapterhorn's;
// - z14+ over the island: an error, so MapLibre overzooms nl-dem's z13
//   parent instead of drawing Mapterhorn's blurrier z14+;
// - everything else: Mapterhorn's tile, as before.

import type * as maplibregl from 'maplibre-gl';

export const NL_DEM_URL = 'https://public.hikeratlas.com/nl-dem/nl-dem.pmtiles';
// pmtiles.js, loaded as a global <script> by routes/map.tsx and, for the
// contours, into maplibre-contour's worker.
export const PMTILES_JS = 'https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js';
export const NL_DEM_ATTRIBUTION =
  "<a href='https://www.gov.nl.ca/exec/tbs/working-with-us/open-government-licence/'>" +
  'Contains information licensed under the Open Government Licence – Newfoundland and Labrador</a>';
export const NL_MINZOOM = 10;
export const NL_MAXZOOM = 13;

const MAPTERHORN = /^https:\/\/tiles\.mapterhorn\.com\/(\d+)\/(\d+)\/(\d+)\.webp$/;

interface Archive {
  getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined>;
}
// pmtiles is loaded as a global <script> (see routes/map.tsx).
declare const pmtiles: { PMTiles: new (url: string) => Archive };

/** A MapLibre transformRequest that sends Mapterhorn tiles through nldem://. */
export function demTransformRequest(url: string): maplibregl.RequestParameters | undefined {
  const m = MAPTERHORN.exec(url);
  return m ? { url: `nldem://${m[1]}/${m[2]}/${m[3]}` } : undefined;
}

let archive: Archive | undefined;
// Recent nl-dem lookups, shared so that a z14+ request's check of its z13
// ancestor and MapLibre's own request for that ancestor fetch it once.
const lookups = new Map<string, Promise<{ data: ArrayBuffer } | undefined>>();

function nlTile(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined> {
  archive ??= new pmtiles.PMTiles(NL_DEM_URL);
  const key = `${z}/${x}/${y}`;
  let got = lookups.get(key);
  if (!got) {
    got = archive.getZxy(z, x, y);
    got.catch(() => lookups.delete(key));
    lookups.set(key, got);
    while (lookups.size > 64) lookups.delete(lookups.keys().next().value!);
  }
  return got;
}

// MapLibre draws a tile's parent, overzoomed, only when the tile failed with
// a 404 status (as Mapterhorn's do below its coverage, e.g. Banff past z12);
// other errors leave a hole.
function notFound(message: string): Error {
  return Object.assign(new Error(message), { status: 404 });
}

export const nlDemProtocol: maplibregl.AddProtocolAction = async (params, abortController) => {
  const [z, x, y] = params.url.replace('nldem://', '').split('/').map(Number);
  if (z >= NL_MINZOOM) {
    let overzoom = false;
    try {
      if (z <= NL_MAXZOOM) {
        const t = await nlTile(z, x, y);
        if (t) return { data: t.data };
      } else {
        const s = z - NL_MAXZOOM;
        overzoom = !!(await nlTile(NL_MAXZOOM, x >> s, y >> s));
      }
    } catch (e) {
      // nl-dem unreachable: fall back to Mapterhorn.
      console.warn('nl-dem lookup failed', e);
    }
    if (overzoom) throw notFound(`nl-dem: ${z}/${x}/${y} is past z${NL_MAXZOOM}; overzoom its ancestor`);
  }
  const r = await fetch(`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`, { signal: abortController.signal });
  if (r.status === 404) throw notFound(`Mapterhorn has no ${z}/${x}/${y}`);
  if (!r.ok) throw Object.assign(new Error(`Mapterhorn ${r.status} for ${z}/${x}/${y}`), { status: r.status });
  return { data: await r.arrayBuffer() };
};
