// Build-time input adapter for the procedural bridge/approach builders.
// The application loads their precomputed mesh files instead of these features.
import type { Map as LibreMap, MapGeoJSONFeature } from 'maplibre-gl';
const stores = new WeakMap<LibreMap, MapGeoJSONFeature[]>();
export function setWorldFeatures(map: LibreMap, features: MapGeoJSONFeature[]) { stores.set(map, features); }
export function mapFeatures(map: LibreMap, layer: 'water' | 'transportation' | 'transportation_name') {
  return (stores.get(map) || []).filter(feature => {
    const p = feature.properties;
    if (layer === 'water') return p.kind === 'water' || p.kind === 'ocean';
    if (layer === 'transportation_name') return p.kind === 'road' && p.brunnel === 'bridge' && p.name;
    return p.kind === 'road' || p.kind === 'rail' || p.kind === 'bridge-outline';
  });
}
