import type { Map, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import { NycBuildingCache } from './nyc-building-cache';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

function meters(value?: string) {
  if (!value) return;
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?\s*(?:m|ft|')?$/.test(text)) return;
  const amount = Number.parseFloat(text);
  return /(?:ft|')$/.test(text) ? amount * 0.3048 : amount;
}

export function attachNycBuildings(map: Map, before?: string) {
  const cache = new NycBuildingCache();
  let request: AbortController | undefined;
  map.addSource('nyc-buildings', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'buildings-3d', type: 'fill-extrusion', source: 'nyc-buildings', minzoom: 14,
    paint: {
      'fill-extrusion-color': '#d8d4c6',
      'fill-extrusion-height': ['get', 'render_height'],
      'fill-extrusion-base': ['get', 'render_min_height'],
      'fill-extrusion-opacity': 0.85,
    },
  }, before);
  const update = async () => {
    request?.abort();
    const current = request = new AbortController();
    const source = map.getSource('nyc-buildings') as GeoJSONSource | undefined;
    if (!source) return;
    if (map.getZoom() < 14) { source.setData(empty); return; }
    const bounds = map.getBounds();
    try {
      const data = await cache.lookup(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), current.signal, true);
      if (current.signal.aborted) return;
      const collection: FeatureCollection<MultiPolygon> = { type: 'FeatureCollection', features: (data?.elements || []).map(element => {
        const tags = element.tags || {};
        const levels = meters(tags['building:levels']);
        const base = meters(tags.min_height) ?? (meters(tags['building:min_level']) ?? 0) * 3;
        const explicit = meters(tags.height);
        const height = Math.max(base, explicit ?? (levels === undefined ? 8 : levels * 3));
        return {
          type: 'Feature', id: `${element.type}/${element.id}`,
          geometry: { type: 'MultiPolygon', coordinates: element.polygons! },
          properties: { name: tags.name || tags['name:en'], osm_type: element.type, osm_id: element.id,
            osm_tags: JSON.stringify(tags), snapshot: data!.osmTimestamp || new Date(data!.time).toISOString(),
            render_height: height, render_min_height: base,
            height_source: explicit === undefined ? levels === undefined ? '8 m display default' : 'building:levels × 3 m estimate' : 'OSM height',
          },
        };
      }) };
      source.setData(collection);
    } catch (error) {
      if (!current.signal.aborted) console.warn('NYC buildings could not load:', error);
    }
  };
  map.on('moveend', update);
  map.on('remove', () => { request?.abort(); map.off('moveend', update); });
  void update();
}
