import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

// pmtiles is loaded as a global <script> (see routes/map.tsx); declare the
// parts we use.
declare const pmtiles: {
  Protocol: new () => { tile: Parameters<typeof maplibregl.addProtocol>[1] };
  PMTiles: new (url: string) => {
    getHeader(): Promise<{ centerLon: number; centerLat: number; centerZoom: number }>;
  };
};

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

    let protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    let scale = new maplibregl.ScaleControl({
        maxWidth: 160,
        unit: 'metric'
    });
    m.addControl(scale);

    if (props.centerOnPmtiles && !hasHashPosition) {
      new pmtiles.PMTiles(props.centerOnPmtiles).getHeader().then((h) => {
        m.jumpTo({ center: [h.centerLon, h.centerLat], zoom: h.centerZoom });
      }).catch((e) => console.error(`Unable to read center from ${props.centerOnPmtiles}`, e));
    }

    map.current = m;
    (props.onInitialized || (() => {}))(m);

  }, [lng, lat, zoom, props]);

  return <div ref={mapContainer} className="map" />;
}
