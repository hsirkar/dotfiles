import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { MercatorCoordinate, type Map as LibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import { bridgeDeckProfile } from './config';
import { mapFeatures } from './world-input';

type Line = number[][];
type Span = { start: Vector3; end: Vector3; length: number };
type BridgeRecord = { spans: Map<string, Span>; root?: TransformNode; length?: number };
const BRIDGE_NAMES = ['Queensboro', 'Brooklyn', 'Manhattan', 'Williamsburg', 'George Washington', 'Wards Island', 'Willis Avenue', 'Third Avenue', 'Madison Avenue', 'Park Avenue', '145th Street', 'Macombs Dam', 'Washington', 'Alexander Hamilton', 'University Heights', 'Broadway', 'Henry Hudson', 'Spuyten Duyvil', 'High Bridge', 'Robert F. Kennedy', 'Triborough', 'Roosevelt Island'];
function bridgeName(raw: string): string | undefined {
  if (!/bridge/i.test(raw) || /approach|exit|plaza|street|boulevard|avenue/i.test(raw.replace(/(Willis|Third|Madison|Park) Avenue|145th Street/gi, ''))) return;
  const match = BRIDGE_NAMES.find(name => raw.toLowerCase().includes(name.toLowerCase()));
  return match ? match === 'High Bridge' ? match : `${match} Bridge` : undefined;
}
function lines(feature: Pick<MapGeoJSONFeature, 'geometry'>): Line[] {
  const geometry = feature.geometry;
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
}
function segmentDistance(p: Vector3, a: Vector3, b: Vector3) {
  const delta = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), delta) / Math.max(delta.lengthSquared(), .001)));
  return Vector3.Distance(p, a.add(delta.scale(t)));
}

function polygons(feature: Pick<MapGeoJSONFeature, 'geometry'>): number[][][][] {
  const geometry = feature.geometry;
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
}
function insideRing(p: Vector3, ring: Vector3[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function riverSpan(map: LibreMap, start: Vector3, end: Vector3, local: (coordinate: number[]) => Vector3) {
  const water = mapFeatures(map, 'water').flatMap(polygons).map(polygon => polygon.map(ring => ring.map(local)));
  const length = Vector3.Distance(start, end), samples = Math.ceil(length / 15);
  let first = Infinity, last = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, point = Vector3.Lerp(start, end, t);
    if (water.some(polygon => insideRing(point, polygon[0]) && !polygon.slice(1).some(hole => insideRing(point, hole)))) {
      first = Math.min(first, t); last = Math.max(last, t);
    }
  }
  if ((last - first) * length < 60) return { start, end };
  // Keep short bank sections while excluding long elevated approach roads from the silhouette.
  return { start: Vector3.Lerp(start, end, Math.max(0, first - 80 / length)), end: Vector3.Lerp(start, end, Math.min(1, last + 80 / length)) };
}
function outlineWidth(map: LibreMap, start: Vector3, end: Vector3, local: (coordinate: number[]) => Vector3) {
  const axis = end.subtract(start).normalize(), across = new Vector3(-axis.z, 0, axis.x);
  const length = Vector3.Distance(start, end), widths: number[] = [];
  for (const feature of mapFeatures(map, 'transportation').filter(feature => feature.properties.kind === 'bridge-outline')) {
    for (const polygon of polygons(feature)) {
      const points = polygon[0].map(local).map(p => ({ x: Vector3.Dot(p.subtract(start), axis), z: Vector3.Dot(p.subtract(start), across) }));
      for (const station of [.3, .5, .7]) {
        const x = station * length, crossings: number[] = [];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i];
          if ((a.x > x) !== (b.x > x)) crossings.push(a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x));
        }
        if (crossings.length >= 2) {
          const low = Math.min(...crossings), high = Math.max(...crossings), width = high - low;
          if (low <= 0 && high >= 0 && width > 3 && width < 80) widths.push(width);
        }
      }
    }
  }
  return widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
}

// Retain complete OSM road ways as new local chunks enter the viewport.
// Original bridge tags and names identify the modeled spans.
export function createBridgeUpdater(scene: Scene, map: LibreMap, origin: MercatorCoordinate, scale: number) {
  const records = new Map<string, BridgeRecord>();
  const local = (coordinate: number[]) => {
    const p = MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]]);
    return new Vector3((p.x - origin.x) / scale, 0, -(p.y - origin.y) / scale);
  };
  const coordinate = (p: Vector3) => new MercatorCoordinate(origin.x + p.x * scale, origin.y - p.z * scale, 0).toLngLat().toArray();
  return () => {
    if (map.getZoom() < 12) return false;
    const named = mapFeatures(map, 'transportation_name').flatMap(feature => {
      const name = bridgeName(String(feature.properties.name || feature.properties.name_en || ''));
      if (!name) return [];
      return lines(feature).map(line => ({ name, points: line.map(local) }));
    });
    const dirty = new Set<string>();
    const features = mapFeatures(map, 'transportation').filter(feature => feature.properties.brunnel === 'bridge');
    for (const feature of features) {
      if (feature.properties.ramp || ['service', 'minor', 'transit'].includes(feature.properties.class)) continue;
      for (const line of lines(feature)) {
        const points = line.map(local);
        const start = points[0], end = points[points.length - 1];
        const length = Vector3.Distance(start, end);
        if (length < 15) continue;
        const midpoint = Vector3.Lerp(start, end, .5);
        const direction = end.subtract(start).normalize();
        let name = bridgeName(String(feature.properties.name || '')), closest = 32;
        for (const label of name ? [] : named) {
          for (let i = 1; i < label.points.length; i++) {
            const labelDirection = label.points[i].subtract(label.points[i - 1]).normalize();
            if (Math.abs(Vector3.Dot(direction, labelDirection)) < .98) continue;
            const distance = segmentDistance(midpoint, label.points[i - 1], label.points[i]);
            if (distance < closest) { closest = distance; name = label.name; }
          }
        }
        if (!name) continue;
        if (!records.has(name)) records.set(name, { spans: new Map() });
        const record = records.get(name)!;
        const key = [...start.asArray(), ...end.asArray()].map(n => Math.round(n * 2)).join(',');
        if (!record.spans.has(key)) { record.spans.set(key, { start, end, length }); dirty.add(name); }
      }
    }
    let changed = false;
    for (const name of dirty) {
      const record = records.get(name)!;
      const spans = [...record.spans.values()].sort((a, b) => b.length - a.length);
      const reference = spans[0];
      const axis = reference.end.subtract(reference.start).normalize();
      if (axis.x < 0) axis.scaleInPlace(-1);
      const across = new Vector3(-axis.z, 0, axis.x);
      const intervals = spans.filter(span => Math.abs(Vector3.Dot(span.end.subtract(span.start).normalize(), axis)) > .995 && Math.max(Math.abs(Vector3.Dot(span.start.subtract(reference.start), across)), Math.abs(Vector3.Dot(span.end.subtract(reference.start), across))) < 35)
        .map(span => {
          const a = Vector3.Dot(span.start.subtract(reference.start), axis), b = Vector3.Dot(span.end.subtract(reference.start), axis);
          return { from: Math.min(a, b), to: Math.max(a, b), lateral: Vector3.Dot(Vector3.Lerp(span.start, span.end, .5).subtract(reference.start), across), weight: span.length };
        }).sort((a, b) => a.from - b.from);
      const clusters: { from: number; to: number; lateral: number; weight: number; count: number }[] = [];
      for (const span of intervals) {
        const previous = clusters[clusters.length - 1];
        if (previous && span.from <= previous.to + 25) {
          previous.to = Math.max(previous.to, span.to); previous.lateral += span.lateral * span.weight; previous.weight += span.weight; previous.count++;
        } else clusters.push({ from: span.from, to: span.to, lateral: span.lateral * span.weight, weight: span.weight, count: 1 });
      }
      clusters.sort((a, b) => (b.to - b.from) - (a.to - a.from));
      const cluster = clusters[0];
      if (!cluster) continue;
      const length = cluster.to - cluster.from;
      if (length < 100 || length <= (record.length || 0) + 10) continue;
      const base = reference.start.add(across.scale(cluster.lateral / cluster.weight));
      const rawStart = base.add(axis.scale(cluster.from)), rawEnd = base.add(axis.scale(cluster.to));
      const { start, end } = riverSpan(map, rawStart, rawEnd, local);
      const width = outlineWidth(map, start, end, local);
      record.root?.dispose(false, true);
      record.root = buildModel(scene, name, start, end, width);
      record.length = length;
      const profile = bridgeDeckProfile(name);
      const info = { deckSurfaceMeters: profile.lowerSurfaceMeters, upperDeckSurfaceMeters: profile.upperSurfaceMeters, name, source: 'nyc-osm-snapshot', sourceLayers: ['roads', 'bridge-outlines', 'coastline-water'], geometrySpanCount: cluster.count, start: coordinate(start), end: coordinate(end), lengthMeters: Vector3.Distance(start, end), sourceLengthMeters: length, widthMeters: width ?? null, widthSource: width ? 'osm-bridge-outline' : 'approximate', laneCount: null, structuralDimensions: 'approximate', kind: name === 'Queensboro Bridge' ? 'cantilever' : /^(Brooklyn|Manhattan|Williamsburg|George Washington) Bridge$/.test(name) ? 'suspension' : 'girder' };
      scene.metadata = { ...scene.metadata, bridges: { ...scene.metadata?.bridges, [name]: info } };
      if (name === 'Queensboro Bridge') scene.metadata.bridge = info;
      changed = true;
    }
    return changed;
  };
}

// OSM geometry supplies alignment; missing tower positions, clearances and profiles remain estimates.
// These lightweight silhouettes are intentionally approximate and use Babylon mesh geometry.
function buildModel(scene: Scene, name: string, start: Vector3, end: Vector3, width?: number) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const length = Vector3.Distance(start, end);
  const direction = end.subtract(start);
  const root = new TransformNode(id, scene);
  root.position = start;
  root.rotation.y = -Math.atan2(direction.z, direction.x);
  const material = (name: string, color: string) => {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    return mat;
  };
  const steel = material('bridge-steel', name === 'Manhattan Bridge' ? '#66817f' : '#716f5b');
  const asphalt = material('bridge-road', '#747a74');
  const stone = material('bridge-piers', '#b4ad95');
  const groups = new Map<StandardMaterial, Mesh[]>();
  const box = (name: string, center: Vector3, dimensions: Vector3, mat: StandardMaterial) => {
    const mesh = MeshBuilder.CreateBox(name, { width: dimensions.x, height: dimensions.y, depth: dimensions.z }, scene);
    mesh.position = center; mesh.material = mat;
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat)!.push(mesh);
    return mesh;
  };
  const beam = (a: Vector3, b: Vector3, width = 1.1) => {
    const delta = b.subtract(a);
    const mesh = box('truss-member', Vector3.Lerp(a, b, 0.5), new Vector3(width, delta.length(), width), steel);
    mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), delta.normalize(), new Quaternion());
  };
  const cantilever = name === 'Queensboro Bridge';
  const suspension = /^(Brooklyn|Manhattan|Williamsburg|George Washington) Bridge$/.test(name);
  const profile = bridgeDeckProfile(name);
  const deck = profile.lowerCenterMeters;
  const upper = profile.upperCenterMeters ?? deck + 10;
  const halfWidth = width ? width / 2 : name === 'George Washington Bridge' ? 17 : /Wards Island|High Bridge/.test(name) ? 4 : 13.5;
  box('lower-deck', new Vector3(length / 2, deck, 0), new Vector3(length, 2.5, halfWidth * 2), asphalt);
  if (cantilever || name === 'George Washington Bridge') box('upper-deck', new Vector3(length / 2, upper, 0), new Vector3(length, 1.7, 18), asphalt);
  const pier = (t: number, height = deck - 3) => {
    box('pier-cap', new Vector3(t * length, height, 0), new Vector3(12, 3, halfWidth * 2 + 7), stone);
    for (const z of [-halfWidth * .7, halfWidth * .7]) box('masonry-pier', new Vector3(t * length, height / 2, z), new Vector3(10, height, 8), stone);
  };
  if (cantilever) {
    const profile = [[0, 10], [.126, 58], [.29, 19], [.443, 58], [.527, 24], [.612, 58], [.75, 19], [.877, 58], [1, 10]];
    const top = (t: number) => {
      const index = profile.findIndex(([x]) => x >= t);
      if (index <= 0) return deck + profile[0][1];
      const a = profile[index - 1], b = profile[index];
      return deck + a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    };
    const stations = [...new Set([...Array.from({ length: 65 }, (_, i) => i / 64), ...profile.map(([t]) => t)])].sort((a, b) => a - b);
    for (const side of [-halfWidth, halfWidth]) {
      for (let i = 0; i < stations.length - 1; i++) {
        const a = stations[i], b = stations[i + 1];
        const bottomA = new Vector3(a * length, deck + 1.5, side), bottomB = new Vector3(b * length, deck + 1.5, side);
        const topA = new Vector3(a * length, top(a), side), topB = new Vector3(b * length, top(b), side);
        beam(bottomA, bottomB, 1.4); beam(topA, topB, 1.7);
        beam(bottomA, topA, .9);
        beam(i % 2 ? topA : bottomA, i % 2 ? bottomB : topB, 1);
        beam(new Vector3(a * length, upper, side), new Vector3(b * length, upper, side), 1);
      }
      beam(new Vector3(length, deck, side), new Vector3(length, top(1), side));
    }
    for (const t of [0, .126, .443, .612, .877, 1]) pier(t);
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, x = t * length;
      beam(new Vector3(x, deck - 1, -halfWidth), new Vector3(x, deck - 1, halfWidth), 1.3);
      beam(new Vector3(x, top(t), -halfWidth), new Vector3(x, top(t), halfWidth), .85);
      if (i < 32) beam(new Vector3(x, top(t), -halfWidth), new Vector3((i + 1) * length / 32, top((i + 1) / 32), halfWidth), .6);
    }
  } else if (suspension) {
    const towerHeight = name === 'Brooklyn Bridge' ? 44 : 75;
    const masonry = name === 'Brooklyn Bridge';
    for (const t of [.23, .77]) {
      pier(t);
      for (const side of [-halfWidth, halfWidth]) {
        box('tower-leg', new Vector3(t * length, deck + towerHeight / 2, side), new Vector3(masonry ? 8 : 4, towerHeight, masonry ? 7 : 4), masonry ? stone : steel);
      }
      for (const h of masonry ? [towerHeight - 5] : [towerHeight * .55, towerHeight - 2]) {
        const towerBeam = box('tower-crossbeam', new Vector3(t * length, deck + h, 0), new Vector3(masonry ? 8 : 4, masonry ? 6 : 3, halfWidth * 2), masonry ? stone : steel);
        towerBeam.isPickable = false;
      }
    }
    const cableHeight = (t: number) => {
      if (t < .23) return deck + 3 + (towerHeight - 3) * t / .23;
      if (t > .77) return deck + 3 + (towerHeight - 3) * (1 - t) / .23;
      return deck + 8 + (towerHeight - 8) * Math.pow((t - .5) / .27, 2);
    };
    for (const side of [-halfWidth, halfWidth]) {
      for (let i = 0; i < 96; i++) {
        const t = i / 96, next = (i + 1) / 96;
        beam(new Vector3(t * length, cableHeight(t), side), new Vector3(next * length, cableHeight(next), side), 1.1);
        if (i % 2 === 0) beam(new Vector3(t * length, deck + 2, side), new Vector3(t * length, cableHeight(t), side), .45);
        if (masonry && i % 8 === 0 && t > .23 && t < .77) {
          const tower = t < .5 ? .23 : .77;
          beam(new Vector3(t * length, deck + 2, side), new Vector3(tower * length, deck + towerHeight - 3, side), .35);
        }
      }
    }
  } else {
    // Unclassified bridge: render a conservative deck and piers.
    const pierCount = Math.max(1, Math.ceil(length / 110));
    for (let i = 0; i <= pierCount; i++) pier(i / pierCount);
  }
  for (const side of [-halfWidth, halfWidth]) {
    beam(new Vector3(0, deck + 2.5, side), new Vector3(length, deck + 2.5, side), .55);
    beam(new Vector3(0, deck - 2, side), new Vector3(length, deck - 2, side), 1.5);
  }
  for (const [mat, meshes] of groups) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (merged) { merged.name = `${id}-${mat.name}`; merged.parent = root; merged.isPickable = false; }
  }
  return root;
}
