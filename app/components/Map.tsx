import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

export interface Props {
  style: string;
  lng: number;
  lat: number;
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [number, number, number, number];
  showTileBoundaries?: boolean;
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

    map.current = m;
    (props.onInitialized || (() => {}))(m);

  }, [lng, lat, zoom, props]);

  return <div ref={mapContainer} className="map" />;
}
