import clipping, { type Polygon, type MultiPolygon, type Pair } from 'polygon-clipping';
import { Point, type Map as LibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import { NycBuildingCache } from './nyc-building-cache';

type ScreenPoint = { x: number; y: number };
type GeoPoint = { lat: number; lon: number };
export type OsmElement = {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  polygons?: MultiPolygon;
  geometry?: GeoPoint[];
  members?: { type: string; role?: string; geometry?: GeoPoint[] }[];
};
type OsmResponse = { elements: OsmElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
type CacheRecord = { time: number; data: OsmResponse };
export type BuildingMatch = { element: OsmElement; coverage: number; fetchedAt: number; cached: boolean; osmTimestamp?: string; source?: 'nyc-snapshot' };
const CACHE = 'queensboro-building-clicks-v1', TTL = 30 * 24 * 60 * 60 * 1000;

function contains(point: Pair, ring: Pair[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inPolygon = (point: Pair, polygon: Polygon) => contains(point, polygon[0]) && !polygon.slice(1).some(hole => contains(point, hole));
const cross = (a: Pair, b: Pair) => a[0] * b[1] - a[1] * b[0];

// A tile feature may contain many unrelated footprints. Pick its actual visible
// component using the click ray between the modeled roof and base planes.
export function clickedFootprint(map: LibreMap, feature: MapGeoJSONFeature, point: ScreenPoint): Polygon | undefined {
  const geometry = feature.geometry;
  const polygons: Polygon[] = geometry.type === 'Polygon' ? [geometry.coordinates as Polygon] : geometry.type === 'MultiPolygon' ? geometry.coordinates as MultiPolygon : [];
  if (!polygons.length) return;
  if (polygons.length === 1) return polygons[0];
  const height = Number(feature.properties.render_height) || 8;
  const base = Number(feature.properties.render_min_height) || 0;
  // MapLibre 6's typed transform utility accounts for the roof's screen offset.
  const transform = map._camera.transform;
  const screen = new Point(point.x, point.y);
  const roof = transform.screenPointToLocationAtElevation(screen, height);
  const ground = transform.screenPointToLocationAtElevation(screen, base);
  const a: Pair = [roof.lng, roof.lat], b: Pair = [ground.lng, ground.lat];
  const atRoof = polygons.find(polygon => inPolygon(a, polygon));
  if (atRoof) return atRoof;
  const direction: Pair = [b[0] - a[0], b[1] - a[1]];
  let closest = Infinity, selected: Polygon | undefined;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const c = ring[i - 1], d = ring[i];
    const edge: Pair = [d[0] - c[0], d[1] - c[1]], delta: Pair = [c[0] - a[0], c[1] - a[1]];
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-20) continue;
    const t = cross(delta, edge) / denominator, u = cross(delta, direction) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < closest) { closest = t; selected = polygon; }
  }
  return selected;
}

// Multipolygon assembly/footprint-overlap matching follows Spiderbench's
// src/maptiles/building-metadata.js; no tile ID is interpreted as an OSM ID.
function memberRings(element: OsmElement, role: string): Pair[][] {
  const pending = (element.members || []).filter(member => member.type === 'way' && (member.role || 'outer') === role && member.geometry && member.geometry.length >= 2)
    .map(member => member.geometry!.map(p => [p.lon, p.lat] as Pair));
  const rings: Pair[][] = [];
  const same = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];
  while (pending.length) {
    const ring = pending.pop()!;
    while (!same(ring[0], ring[ring.length - 1])) {
      const index = pending.findIndex(next => same(ring[ring.length - 1], next[0]) || same(ring[ring.length - 1], next[next.length - 1]));
      if (index < 0) break;
      const next = pending.splice(index, 1)[0];
      if (!same(ring[ring.length - 1], next[0])) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}
function elementPolygons(element: OsmElement): MultiPolygon {
  if (element.polygons) return element.polygons;
  if (element.type === 'way') {
    const ring = element.geometry?.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lon, p.lat] as Pair);
    return ring && ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? [[ring]] : [];
  }
  const outers = memberRings(element, 'outer'), inners = memberRings(element, 'inner');
  return outers.map(outer => [outer, ...inners.filter(inner => contains(inner[0], outer))]);
}
function area(polygons: MultiPolygon) {
  const ringArea = (ring: Pair[]) => {
    // Translate first, avoiding cancellation for tiny footprints at large coordinates.
    const [x, y] = ring[0];
    return Math.abs(ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return sum + (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y);
    }, 0)) / 2;
  };
  return polygons.reduce((sum, polygon) => sum + ringArea(polygon[0]) - polygon.slice(1).reduce((holes, hole) => holes + ringArea(hole), 0), 0);
}
function matchBuilding(data: OsmResponse, footprint: Polygon, base: number, height: number) {
  const size = area([footprint]);
  if (!size) return;
  const candidates: { element: OsmElement; coverage: number; area: number }[] = [];
  for (const element of data.elements) {
    if (!['way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) continue;
    const tags = element.tags || {};
    if (tags['building:part']) {
      const min = Number.parseFloat(tags.min_height || '0'), max = Number.parseFloat(tags.height || 'Infinity');
      if (height < min - .5 || base > max + .5) continue;
    }
    const polygons = elementPolygons(element);
    if (!polygons.length) continue;
    try {
      const coverage = area(clipping.intersection([footprint], polygons)) / size;
      if (coverage >= .6) candidates.push({ element, coverage: Math.min(1, coverage), area: area(polygons) });
    } catch { /* A malformed source ring cannot establish a match. */ }
  }
  candidates.sort((a, b) => Math.round(b.coverage * 20) - Math.round(a.coverage * 20) || a.area - b.area || a.element.id - b.element.id);
  return candidates[0];
}
function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class BuildingLookup {
  private nyc = new NycBuildingCache();
  private memory = new Map<string, CacheRecord>();
  private disk = globalThis.caches?.open(CACHE).catch(() => undefined);
  private nextRequest = 0;
  private cooldown = 0;

  async lookup(footprint: Polygon, base: number, height: number, signal: AbortSignal): Promise<BuildingMatch | undefined> {
    const points = footprint.flat();
    const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
    const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
    if (north - south > .025 || east - west > .035) throw new Error('Could not isolate a small building footprint for lookup.');
    const local = await this.nyc.lookup(west, south, east, north, signal);
    if (local) {
      const match = matchBuilding({ elements: local.elements }, footprint, base, height);
      return match ? { element: match.element, coverage: match.coverage, fetchedAt: local.time,
        cached: true, osmTimestamp: local.osmTimestamp, source: 'nyc-snapshot' } : undefined;
    }
    const padding = .00009;
    const box = [south - padding, west - padding, north + padding, east + padding].map(n => n.toFixed(7)).join(',');
    const url = `${location.origin}/__osm-building-cache/${box}`;
    const disk = await this.disk;
    let record = this.memory.get(box);
    if (!record) try { const cached = await disk?.match(url); if (cached) record = await cached.json(); } catch { /* Memory-only fallback. */ }
    const cached = !!record && Date.now() - record.time < TTL && Array.isArray(record.data?.elements);
    signal.throwIfAborted();
    if (!cached) {
      if (Date.now() < this.cooldown) throw new Error('Overpass is rate-limited. Please try again in a minute.');
      // Collapse rapid clicks and keep a modest interval between requests.
      await abortableDelay(Math.max(350, this.nextRequest - Date.now()), signal);
      this.nextRequest = Date.now() + 1200;
      const query = `[out:json][timeout:15][maxsize:16777216];(way["building"](${box});way["building:part"](${box});relation["type"="multipolygon"]["building"](${box});relation["type"="multipolygon"]["building:part"](${box});way["man_made"~"^(bridge_pier|tower)$"](${box}););out body geom;`;
      const endpoint = import.meta.env.VITE_OVERPASS_URL || 'https://overpass.private.coffee/api/interpreter';
      const response = await fetch(endpoint, {
        method: 'POST', body: new URLSearchParams({ data: query }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(22000)]),
      });
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After');
        const seconds = Number(retry), date = Date.parse(retry || '');
        this.cooldown = Date.now() + Math.max(60000, retry && Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 60000);
        throw new Error('Overpass is busy. Please try again in a minute.');
      }
      if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}. Try again later.`);
      const data: OsmResponse = await response.json();
      if (!Array.isArray(data.elements) || data.remark) throw new Error(data.remark || 'Overpass returned an invalid response.');
      record = { time: Date.now(), data };
      // Cache raw responses, preserving the distinction between OSM and tile attributes.
      if (disk) void disk.put(url, new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json' } })).then(async () => {
        const keys = await disk.keys();
        for (const key of keys.slice(0, Math.max(0, keys.length - 100))) await disk.delete(key);
      }).catch(() => {});
    }
    signal.throwIfAborted();
    if (!record) return;
    this.memory.delete(box); this.memory.set(box, record);
    while (this.memory.size > 32) this.memory.delete(this.memory.keys().next().value!);
    const match = matchBuilding(record.data, footprint, base, height);
    return match ? { element: match.element, coverage: match.coverage, fetchedAt: record.time, cached, osmTimestamp: record.data.osm3s?.timestamp_osm_base } : undefined;
  }
}
