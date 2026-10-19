import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { HOME } from './config';
import { createPlacesLayer } from './world';
import { attachBuildingInspector } from './building-inspector';
import { localMapStyle } from './local-map';
import { BuildingTags, loadTileManifest, registerLocalTiles } from './tile-data';

document.querySelector<HTMLDivElement>('#app')!.innerHTML =
  '<div id="map" aria-label="Interactive map of New York\'s East River"></div>';

// Bundle the MapLibre 6 worker explicitly so vector tiles load in Vite.
maplibregl.setWorkerUrl(workerUrl);
async function start() {
  const manifest = await loadTileManifest();
  registerLocalTiles(manifest);
  const [west, south, east, north] = manifest.bounds;
  const map = new maplibregl.Map({ container:'map', style:localMapStyle(manifest), maxBounds:[[west,south],[east,north]], minZoom:10, maxZoom:20, renderWorldCopies:false, ...HOME, maxPitch:70, attributionControl:{compact:true}, canvasContextAttributes:{antialias:true} });
  if (import.meta.env.DEV) Object.assign(window, { __atlasMap: map });
  attachBuildingInspector(map, new BuildingTags(manifest));
  map.on('style.load', () => map.addLayer(createPlacesLayer(manifest)));
  map.on('error', event => console.warn('Map resource:', event.error.message));
}
void start().catch(error => {
  console.error('Prepare local tiles with npm run tiles:build:', error);
  const message = document.createElement('p');
  message.setAttribute('role', 'alert'); message.textContent = 'Local map data is unavailable.';
  document.querySelector('#app')!.append(message);
});
