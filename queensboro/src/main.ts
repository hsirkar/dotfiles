import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { HOME } from './config';
import { createPlacesLayer } from './world';
import { attachBuildingInspector } from './building-inspector';
import { attachNycBuildings } from './nyc-buildings';
import { attachLocalMap, localMapStyle } from './local-map';

document.querySelector<HTMLDivElement>('#app')!.innerHTML =
  '<div id="map" aria-label="Interactive map of New York\'s East River"></div>';

// Bundle the MapLibre 6 worker explicitly so vector tiles load in Vite.
maplibregl.setWorkerUrl(workerUrl);
const map = new maplibregl.Map({container:'map',style: localMapStyle(), maxBounds: [[-74.36, 40.48], [-73.67, 40.96]], minZoom: 10, renderWorldCopies: false,...HOME, maxPitch:70, attributionControl:{compact:true}, canvasContextAttributes:{antialias:true}});
if (import.meta.env.DEV) Object.assign(window, { __atlasMap: map });
attachBuildingInspector(map);
map.on('style.load', () => {
  const style = map.getStyle();
  attachLocalMap(map);
  attachNycBuildings(map, style.layers.find(layer => layer.type === 'symbol')?.id);
  map.addLayer(createPlacesLayer());
});
map.on('error', event => console.warn('Map resource:', event.error.message));
