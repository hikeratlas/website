import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import { withZstd, type Decompress } from '~/zstd';

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
// instead. (pmtiles v2 has no option for this: Protocol looks archives up in
// `tiles`, and only makes its own if that comes back empty.)
function zstdProtocol() {
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
  onInitialized: (x: any) => {};
}

export default function Map(props: Props) {
  const mapContainer = useRef(null);
  const map = useRef(null);
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

    let m = new maplibregl.Map({
      container: mapContainer.current,
      hash: true,
      style: props.style,
      center: [lng, lat],
      maxBounds:  props.maxBounds,
      zoom: zoom,
      minZoom: props.minZoom,
      maxZoom: props.maxZoom,
    });
    m.showTileBoundaries = !!props.showTileBoundaries;

    const protocol = zstdProtocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    let scale = new maplibregl.ScaleControl({
        maxWidth: 160,
        unit: 'metric'
    });
    m.addControl(scale);

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
