import { useRef, useEffect, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { ImageryControl } from '~/components/imagery';
import mlcontour from 'maplibre-contour';
import { withDemFallback } from '~/components/demFallback';
import {
  demTransformRequest, nlDemProtocol, NL_BOUNDS, NL_DEM_ATTRIBUTION, NL_DEM_URL, NL_MAXZOOM, NL_MINZOOM, PMTILES_JS,
} from '~/components/nlDem';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import { withZstd, type Decompress } from '~/zstd';
import { WORLDCOVER_ATTRIBUTION } from '~/park';

// pmtiles is loaded as a global <script> (see routes/map.tsx); declare the
// parts we use.
interface PMTiles {
  decompress: Decompress;
  getHeader(): Promise<{ centerLon: number; centerLat: number; centerZoom: number }>;
}
declare const pmtiles: {
  Protocol: new () => {
    tile: Parameters<typeof maplibregl.addProtocol>[1];
    tiles: Map<string, PMTiles>;
  };
  PMTiles: new (url: string, cache?: unknown, decompress?: Decompress) => PMTiles;
};

// pmtiles.js's Protocol makes a PMTiles for each archive URL it sees, with the
// default (gzip-only) decompress function. Make them with zstd support
// instead. (pmtiles v4 has no option for this: Protocol looks archives up in
// `tiles`, and only makes its own if that comes back empty.)
export function zstdProtocol() {
  // pmtiles.js doesn't export its default decompress function, so borrow it
  // from an instance. Constructing one doesn't fetch anything.
  const decompress = withZstd(new pmtiles.PMTiles("").decompress);
  const protocol = new pmtiles.Protocol();
  const archives = new globalThis.Map<string, PMTiles>();
  protocol.tiles = {
    get(url: string) {
      let p = archives.get(url);
      if (!p) {
        p = new pmtiles.PMTiles(url, undefined, decompress);
        archives.set(url, p);
      }
      return p;
    },
    set(url: string, p: PMTiles) {
      archives.set(url, p);
      return this;
    },
  } as Map<string, PMTiles>;
  return protocol;
}

// Contour lines are generated in the browser from the same Mapterhorn DEM the
// style's hillshade uses: no contour tiles to build or host. This registers
// the dem-contour:// protocol; the basemap style decides intervals and looks
// via its "contours" source URL. Registered once per page load, before any
// map asks for tiles.
let contoursRegistered = false;
export function registerContours() {
  if (contoursRegistered) return;
  contoursRegistered = true;
  // Mapterhorn 404s below its coverage (z12 in Banff); fill those from the
  // parent tile rather than leaving holes in the contours. Over Newfoundland,
  // use nl-dem's 5 m tiles instead (see nlDem.ts).
  withDemFallback(mlcontour, { archive: NL_DEM_URL, pmtilesJs: PMTILES_JS, minzoom: NL_MINZOOM, maxzoom: NL_MAXZOOM, bounds: NL_BOUNDS });
  new mlcontour.DemSource({
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    encoding: "terrarium",
    // 512 px tiles: z14 is ~5 m/px, finer than the 10 m contour interval
    // needs, and the same tiles the hillshade loads at map zoom 15.
    maxzoom: 14,
    id: "dem", // protocol dem-contour://
    worker: true,
  }).setupMaplibre(maplibregl);
}

export interface Props {
  style: string;
  lng: number;
  lat: number;
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [number, number, number, number];
  showTileBoundaries?: boolean;
  // If set, and the URL has no #zoom/lat/lng position, start at the center
  // recorded in this .pmtiles file's header. (The header's bounds aren't
  // reliable: tile-smush records 0 as the max longitude for areas west of
  // Greenwich.)
  centerOnPmtiles?: string;
  onInitialized: (map: maplibregl.Map) => void;
}

export default function Map(props: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // gsmnp: 9.18/35.6311/-83.371
  // rockies: 6.45/51.537/-118.245
  const [lng] = useState(props.lng);
  const [lat] = useState(props.lat);
  const [zoom] = useState(props.zoom);

  useEffect(() => {
    if (map.current) return; // stops map from intializing more than once

    // Check before creating the map: with hash: true, maplibre writes the
    // initial position into the hash as soon as it's constructed.
    const hasHashPosition = window.location.hash.length > 1;

    // maplibre-gl 6 is ESM-only and loads its worker from a URL next to its
    // own module. Remix bundles maplibre into a chunk under /build/, where the
    // worker isn't, so point it at the copy the build script puts in public/.
    maplibregl.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
    registerContours();
    // The hillshade's Mapterhorn tiles go through nldem://, which serves
    // nl-dem's over Newfoundland (see nlDem.ts).
    maplibregl.addProtocol("nldem", nlDemProtocol);

    const m = new maplibregl.Map({
      container: mapContainer.current!,
      hash: true,
      style: props.style,
      transformRequest: demTransformRequest,
      center: [lng, lat],
      maxBounds:  props.maxBounds,
      zoom: zoom,
      minZoom: props.minZoom,
      maxZoom: props.maxZoom,
      // An (i) that expands, rather than two lines of credits across the
      // bottom of a phone screen.
      attributionControl: { compact: true, customAttribution: [NL_DEM_ATTRIBUTION, WORLDCOVER_ATTRIBUTION] },
    });
    m.showTileBoundaries = !!props.showTileBoundaries;

    const protocol = zstdProtocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const scale = new maplibregl.ScaleControl({
        maxWidth: 160,
        unit: 'metric'
    });
    m.addControl(scale);

    // Compact attribution starts expanded and only collapses on the first
    // drag; start collapsed. Collapsed, it reads "© OpenStreetMap" (the short
    // form the OSMF attribution guidelines allow), and tapping that or the (i)
    // expands the full credits.
    m.once('load', () => {
      const attrib = m.getContainer().querySelector('.maplibregl-ctrl-attrib');
      if (!attrib) return;
      attrib.classList.remove('maplibregl-compact-show');
      const short = document.createElement('button');
      short.type = 'button';
      short.className = 'attrib-short';
      short.textContent = '© OpenStreetMap';
      short.title = 'Show map credits';
      short.addEventListener('click', () => {
        attrib.setAttribute('open', '');
        attrib.classList.add('maplibregl-compact-show');
      });
      // Beside the control, not in it: the control is a <details>, and once
      // closed only its <summary> (the (i)) is drawn. CSS hides the label
      // while the credits are expanded.
      attrib.parentElement?.insertBefore(short, attrib.nextSibling);
    });

    // "Where am I?": the most useful thing on a phone at a trailhead. Tapping
    // it again follows you as you move.
    m.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    }), 'top-right');

    // Aerial imagery on and off (hikeratlas/basemap#172; see imagery.ts).
    m.addControl(new ImageryControl(), 'top-right');

    if (props.centerOnPmtiles && !hasHashPosition) {
      protocol.tiles.get(props.centerOnPmtiles)!.getHeader().then((h) => {
        m.jumpTo({ center: [h.centerLon, h.centerLat], zoom: h.centerZoom });
      }).catch((e) => console.error(`Unable to read center from ${props.centerOnPmtiles}`, e));
    }

    map.current = m;
    (props.onInitialized || (() => {}))(m);

  }, [lng, lat, zoom, props]);

  return <div ref={mapContainer} className="map" />;
}
