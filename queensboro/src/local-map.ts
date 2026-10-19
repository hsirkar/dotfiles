import type { Map as LibreMap, GeoJSONSource, MapGeoJSONFeature, StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

type LocalFeature = Feature<Geometry, Record<string, string | number | boolean>>;
type Manifest = { version: string; cellSize: number; bounds: [number, number, number, number]; cells: string[] };
type IndexedFeature = { feature: LocalFeature; bbox: number[] };
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const stores = new WeakMap<LibreMap, LocalFeature[]>();
const base = import.meta.env.BASE_URL;
const isKind = (kind: string): ExpressionSpecification => ['==', ['get', 'kind'], kind];

export function localMapStyle(): StyleSpecification {
  return {
    version: 8,
    'font-faces': { 'Noto Sans': `${base}fonts/NotoSans-Regular.ttf` },
    sources: {
      'nyc-overview': { type: 'geojson', data: empty, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxzoom: 15 },
      'nyc-detail': { type: 'geojson', data: empty, maxzoom: 18 },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#a7c4c1' } },
      { id: 'land', type: 'fill', source: 'nyc-overview', filter: isKind('land'), paint: { 'fill-color': '#eeece4' } },
      ...['nyc-overview', 'nyc-detail'].flatMap(source => [
        { id: `${source}-landuse`, type: 'fill' as const, source, filter: isKind('landuse'), paint: {
          'fill-color': ['case', ['in', ['get', 'landuse'], ['literal', ['industrial', 'commercial', 'retail']]], '#e1dcd2',
            ['in', ['get', 'landuse'], ['literal', ['residential', 'construction']]], '#e9e5dc', '#c7d0b1'], 'fill-opacity': .75,
        } },
        { id: `${source}-water`, type: 'fill' as const, source, filter: ['in', ['get', 'kind'], ['literal', ['water', 'ocean']]], paint: { 'fill-color': '#a7c4c1' } },
        { id: `${source}-waterways`, type: 'line' as const, source, filter: isKind('waterway'), paint: { 'line-color': '#a7c4c1', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 17, 5] } },
      ]) as StyleSpecification['layers'],
      ...(['nyc-overview', 'nyc-detail'] as const).flatMap(source => {
        const distant = source === 'nyc-overview';
        const filter: ExpressionSpecification = distant ? isKind('overview-road') : ['all', isKind('road'), ['any', ['==', ['get', 'brunnel'], 'bridge'], ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link']]]]];
        return [
          { id: distant ? 'major-overview-casing' : 'major-road-casing', type: 'line', source, minzoom: distant ? 0 : 13, maxzoom: distant ? 13 : 24, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#d1ccbf', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 5, 18, 18] } },
          { id: distant ? 'major-overview-roads' : 'major-roads', type: 'line', source, minzoom: distant ? 0 : 13, maxzoom: distant ? 13 : 24, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#faf8f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .6, 14, 3, 18, 14] } },
        ] as StyleSpecification['layers'];
      }),
      { id: 'local-roads', type: 'line', source: 'nyc-detail', minzoom: 13, filter: ['all', isKind('road'), ['!', ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link']]]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#faf9f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .8, 16, ['match', ['get', 'highway'], ['footway', 'path', 'steps', 'cycleway'], 1, 4], 19, ['match', ['get', 'highway'], ['footway', 'path', 'steps', 'cycleway'], 3, 15]] } },
      { id: 'railways', type: 'line', source: 'nyc-detail', minzoom: 13, filter: ['all', isKind('rail'), ['!=', ['get', 'tunnel'], 'yes']], paint: { 'line-color': '#a49f92', 'line-width': 1, 'line-dasharray': [3, 2] } },
      { id: 'road-labels', type: 'symbol', source: 'nyc-detail', minzoom: 15, filter: ['all', isKind('road'), ['has', 'name'], ['!', ['in', ['get', 'highway'], ['literal', ['footway', 'path', 'steps', 'service']]]]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans'], 'text-size': 10, 'text-max-angle': 30 },
        paint: { 'text-color': '#79796e', 'text-halo-color': '#f7f5ec', 'text-halo-width': 1.2 } },
      { id: 'place-labels', type: 'symbol', source: 'nyc-overview', minzoom: 10, filter: ['all', isKind('place'), ['in', ['get', 'place'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'island']]]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans'], 'text-size': ['match', ['get', 'place'], 'city', 18, 'suburb', 13, 11], 'text-transform': 'uppercase', 'text-padding': 20 },
        paint: { 'text-color': '#77796b', 'text-halo-color': '#f5f3e9', 'text-halo-width': 1.4 } },
      { id: 'poi-labels', type: 'symbol', source: 'nyc-detail', minzoom: 16, filter: isKind('poi'),
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans'], 'text-size': 10, 'text-max-width': 12, 'text-padding': 8 },
        paint: { 'text-color': '#61715b', 'text-halo-color': '#f5f3e9', 'text-halo-width': 1.2 } },
    ],
  };
}

// Babylon receives original whole-feature geometry, not MapLibre's internally
// clipped GeoJSON render buckets. This preserves paths as the viewport changes.
export function mapFeatures(map: LibreMap, layer: 'water' | 'transportation' | 'transportation_name'): MapGeoJSONFeature[] {
  const features = stores.get(map) || [];
  return features.filter(feature => {
    const p = feature.properties;
    if (layer === 'water') return p.kind === 'water' || p.kind === 'ocean';
    if (layer === 'transportation_name') return p.kind === 'road' && p.brunnel === 'bridge' && p.name;
    return p.kind === 'road' || p.kind === 'rail' || p.kind === 'bridge-outline';
  }) as unknown as MapGeoJSONFeature[];
}

function indexed(feature: LocalFeature): IndexedFeature {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      bbox[0] = Math.min(bbox[0], value[0]); bbox[1] = Math.min(bbox[1], value[1]);
      bbox[2] = Math.max(bbox[2], value[0]); bbox[3] = Math.max(bbox[3], value[1]);
    } else value.forEach(visit);
  }
  if ('coordinates' in feature.geometry) visit(feature.geometry.coordinates);
  return { feature, bbox };
}

export function attachLocalMap(map: LibreMap) {
  const root = `${base}nyc-map/`;
  const disk = globalThis.caches?.open('queensboro-nyc-map-v1').catch(() => undefined);
  let manifest: Manifest;
  let overview: IndexedFeature[] = [];
  const chunks = new Map<string, LocalFeature[]>();
  let request: AbortController | undefined;
  let disposed = false;
  async function json(path: string, signal?: AbortSignal, revalidate = false) {
    const url = `${root}${path}`;
    const cache = await disk;
    let response: Response | undefined;
    if (!revalidate) try { response = await cache?.match(url); } catch { /* Storage optional. */ }
    if (!response) {
      try {
        response = await fetch(url, { signal, cache: revalidate ? 'no-cache' : 'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
      } catch (error) {
        signal?.throwIfAborted();
        try { response = await cache?.match(url); } catch { /* Storage optional. */ }
        if (!response) throw error;
      }
    }
    const result = await response.clone().json();
    try { await cache?.put(url, response); } catch { /* Memory-only fallback. */ }
    return result;
  }
  const update = async () => {
    if (!manifest || disposed) return;
    request?.abort();
    const current = request = new AbortController();
    const b = map.getBounds();
    const bounds = [b.getWest() - .015, b.getSouth() - .015, b.getEast() + .015, b.getNorth() + .015];
    const nearby = overview.filter(({ bbox }) => bbox[2] >= bounds[0] && bbox[0] <= bounds[2] && bbox[3] >= bounds[1] && bbox[1] <= bounds[3]).map(item => item.feature);
    const keys: string[] = [];
    if (map.getZoom() >= 13) {
      const [w, s, e, n] = manifest.bounds;
      for (let x = Math.floor(Math.max(bounds[0], w) / manifest.cellSize); x <= Math.floor(Math.min(bounds[2], e) / manifest.cellSize); x++) {
        for (let y = Math.floor(Math.max(bounds[1], s) / manifest.cellSize); y <= Math.floor(Math.min(bounds[3], n) / manifest.cellSize); y++) {
          const key = `${x}_${y}`;
          if (manifest.cells.includes(key)) keys.push(key);
        }
      }
    }
    try {
      const loaded = await Promise.all(keys.map(async key => {
        if (!chunks.has(key)) {
          const features = await json(`${key}.json?v=${manifest.version}`, current.signal) as LocalFeature[];
          if (current.signal.aborted) return [];
          chunks.set(key, features);
          while (chunks.size > 64) chunks.delete(chunks.keys().next().value!);
          return features;
        }
        return chunks.get(key)!;
      }));
      if (current.signal.aborted || disposed) return;
      const features = [...new Map(loaded.flat().map(feature => [feature.id, feature])).values()];
      const all = [...new Map([...nearby, ...features].map(feature => [feature.id, feature])).values()];
      stores.set(map, all);
      (map.getSource('nyc-detail') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
      // World geometry is updated only after the complete viewport batch arrives.
      map.triggerRepaint();
    } catch (error) {
      if (!current.signal.aborted) console.warn('Local map data could not load:', error);
    }
  };
  map.on('moveend', update);
  map.on('remove', () => { disposed = true; request?.abort(); map.off('moveend', update); stores.delete(map); });
  void (async () => {
    try {
      manifest = await json('manifest.json', undefined, true);
      const data = await json(`overview.json?v=${manifest.version}`) as FeatureCollection<Geometry, LocalFeature['properties']>;
      if (disposed) return;
      overview = data.features.map(indexed);
      (map.getSource('nyc-overview') as GeoJSONSource).setData(data);
      await update();
    } catch (error) { if (!disposed) console.error('Prepare local map data with npm run cache:map:', error); }
  })();
}
