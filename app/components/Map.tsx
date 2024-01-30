import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

export interface Props {
  onInitialized: (x: any) => {};
}

export default function Map(props: Props) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  // gsmnp: 9.18/35.6311/-83.371
  // rockies: 6.45/51.537/-118.245
  const [lng] = useState(-118.245);
  const [lat] = useState(51.537);
  const [zoom] = useState(6.5);

  useEffect(() => {
    if (map.current) return; // stops map from intializing more than once

    let m = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://public.hikeratlas.com/style.json`,
      center: [lng, lat],
      maxBounds:  [-170, 20, -48, 75],
      showTileBoundaries: true,
      zoom: zoom
    });

    let protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    map.current = m;
    (props.onInitialized || (() => {}))(m);

  }, [lng, lat, zoom, props]);

  return <div ref={mapContainer} className="map" />;
}
