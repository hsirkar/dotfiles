import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { assetUrl, type TileManifest } from './tile-data';
const isKind = (kind: string): ExpressionSpecification => ['==', ['get', 'kind'], kind];
const major: ExpressionSpecification = ['any', ['==', ['get', 'brunnel'], 'bridge'], ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link']]]];

export function localMapStyle(manifest: TileManifest): StyleSpecification {
  return {
    version: 8,
    'font-faces': { 'Noto Sans': `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf` },
    sources: { nyc: { type: 'vector', url: `pmtiles://${assetUrl(manifest.archive)}`, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#a7c4c1' } },
      { id: 'land', type: 'fill', source: 'nyc', 'source-layer': 'land', paint: { 'fill-color': '#eeece4' } },
      { id: 'landuse', type: 'fill', source: 'nyc', 'source-layer': 'landuse', paint: {
        'fill-color': ['case', ['in', ['get', 'landuse'], ['literal', ['industrial', 'commercial', 'retail']]], '#e1dcd2', ['in', ['get', 'landuse'], ['literal', ['residential', 'construction']]], '#e9e5dc', '#c7d0b1'], 'fill-opacity': .75,
      } },
      { id: 'water', type: 'fill', source: 'nyc', 'source-layer': 'water', paint: { 'fill-color': '#a7c4c1' } },
      { id: 'waterways', type: 'line', source: 'nyc', 'source-layer': 'waterway', paint: { 'line-color': '#a7c4c1', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 17, 5] } },
      { id: 'major-road-casing', type: 'line', source: 'nyc', 'source-layer': 'road', filter: major, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#d1ccbf', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 5, 18, 18] } },
      { id: 'major-roads', type: 'line', source: 'nyc', 'source-layer': 'road', filter: major, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#faf8f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .6, 14, 3, 18, 14] } },
      { id: 'local-roads', type: 'line', source: 'nyc', 'source-layer': 'road', minzoom: 13, filter: ['!', major], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#faf9f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .8, 16, ['match', ['get', 'highway'], ['footway', 'path', 'steps', 'cycleway'], 1, 4], 19, ['match', ['get', 'highway'], ['footway', 'path', 'steps', 'cycleway'], 3, 15]] } },
      { id: 'railways', type: 'line', source: 'nyc', 'source-layer': 'rail', minzoom: 13, filter: ['!=', ['get', 'tunnel'], 'yes'], paint: { 'line-color': '#a49f92', 'line-width': 1, 'line-dasharray': [3, 2] } },
      { id: 'buildings-3d', type: 'fill-extrusion', source: 'nyc', 'source-layer': 'building', minzoom: 14, paint: { 'fill-extrusion-color': '#d8d4c6', 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-opacity': .85 } },
      { id: 'road-labels', type: 'symbol', source: 'nyc', 'source-layer': 'road', minzoom: 15, filter: ['all', ['has', 'name'], ['!', ['in', ['get', 'highway'], ['literal', ['footway', 'path', 'steps', 'service']]]]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans'], 'text-size': 10, 'text-max-angle': 30 }, paint: { 'text-color': '#79796e', 'text-halo-color': '#f7f5ec', 'text-halo-width': 1.2 } },
      { id: 'place-labels', type: 'symbol', source: 'nyc', 'source-layer': 'place', minzoom: 10, filter: ['in', ['get', 'place'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'island']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans'], 'text-size': ['match', ['get', 'place'], 'city', 18, 'suburb', 13, 11], 'text-transform': 'uppercase', 'text-padding': 20 }, paint: { 'text-color': '#77796b', 'text-halo-color': '#f5f3e9', 'text-halo-width': 1.4 } },
      { id: 'poi-labels', type: 'symbol', source: 'nyc', 'source-layer': 'poi', minzoom: 16,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans'], 'text-size': 10, 'text-max-width': 12, 'text-padding': 8 }, paint: { 'text-color': '#61715b', 'text-halo-color': '#f5f3e9', 'text-halo-width': 1.2 } },
    ],
  };
}
