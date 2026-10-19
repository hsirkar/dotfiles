import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { HOME } from './config';
import { createPlacesLayer } from './world';

document.querySelector<HTMLDivElement>('#app')!.innerHTML =
  '<div id="map" aria-label="Interactive map of New York\'s East River"></div>';

// Bundle the MapLibre 6 worker explicitly so vector tiles load in Vite.
maplibregl.setWorkerUrl(workerUrl);
const map = new maplibregl.Map({container:'map',style: {version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#ebe9df'}}]},...HOME, maxPitch:70, attributionControl:{compact:true}, canvasContextAttributes:{antialias:true}});
if (import.meta.env.DEV) Object.assign(window, { __atlasMap: map });
async function loadMap() {
  try {
    const response = await fetch('https://tiles.openfreemap.org/styles/positron');
    if (!response.ok) throw new Error('Tile style unavailable');
    const style: StyleSpecification = await response.json();
    for (const layer of style.layers) {
      if (layer.type === 'background') layer.paint = {'background-color':'#eeece4'};
      if (layer.type === 'fill') {
        const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : '';
        if (sourceLayer === 'water') layer.paint = {...layer.paint,'fill-color':'#a7c4c1'};
        if (sourceLayer === 'park' || sourceLayer === 'landcover') layer.paint = {...layer.paint,'fill-color':'#c7d0b1'};
        if (sourceLayer === 'building') layer.paint = {...layer.paint,'fill-color':'#d9d7cc'};
      }
    }
    map.setStyle(style);
  } catch (error) {
    console.error('Map tiles could not load:', error);
  }
}
map.on('style.load', () => {
  const style = map.getStyle();
  const source = Object.entries(style.sources).find(([,s])=>s.type==='vector')?.[0];
  if (!source) return;
  map.addLayer(createPlacesLayer());
});
map.on('error', event => console.warn('Map resource:', event.error.message));
void loadMap();
