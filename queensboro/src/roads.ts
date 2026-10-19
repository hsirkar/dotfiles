import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { MercatorCoordinate, type Map as LibreMap } from 'maplibre-gl';
import { ROAD_RENDERING, BRIDGE_APPROACHES } from './config';
import { mapFeatures } from './local-map';
import { raiseBridgeApproaches, type BridgeDeck, type RoadPath } from './approaches';

// Exclude non-road transport, rather than maintaining an incomplete road whitelist.
const NON_ROAD_CLASSES = new Set(['rail', 'transit', 'ferry', 'aerialway', 'bridge']);
type CachedRoad = {
  coordinates: number[][];
  width: number;
  explicitWidth: boolean;
  roadClass: string;
  layer: number;
  brunnel: string;
  key: string;
};

// Build one batched Babylon surface for bridge decks and connected approach segments.
// Missing widths use a consistent cartographic stroke. Never infer lanes from road class.
export function createRoadUpdater(scene: Scene, map: LibreMap, origin: MercatorCoordinate, scale: number) {
  let mesh: Mesh | undefined;
  let signature = '';
  // The loader replaces viewport chunks as the camera moves. Retain bridge-area source
  // geometry independently so those unloads cannot remove roads from our mesh.
  const roadCache = new Map<string, CachedRoad>();
  const material = new StandardMaterial('road-surface', scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString('#7e857c');
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return () => {
    const bridges = Object.values(scene.metadata?.bridges || {}) as BridgeDeck[];
    // No bridge model means no approach can be drawn: skip querying city roads.
    if (!bridges.length) return false;
    const windows = bridges.map(bridge => {
      const height = Math.max(bridge.deckSurfaceMeters, bridge.upperDeckSurfaceMeters || 0);
      const reach = height * 1.5 / BRIDGE_APPROACHES.maxGrade + BRIDGE_APPROACHES.nodeSnapMeters * 2;
      const latitude = (bridge.start[1] + bridge.end[1]) / 2;
      const latMargin = reach / 111320, lngMargin = latMargin / Math.cos(latitude * Math.PI / 180);
      return {
        west: Math.min(bridge.start[0], bridge.end[0]) - lngMargin,
        east: Math.max(bridge.start[0], bridge.end[0]) + lngMargin,
        south: Math.min(bridge.start[1], bridge.end[1]) - latMargin,
        north: Math.max(bridge.start[1], bridge.end[1]) + latMargin,
      };
    });
    for (const feature of mapFeatures(map, 'transportation')) {
      const properties = feature.properties;
      if (NON_ROAD_CLASSES.has(properties.class)) continue;
      const geometry = feature.geometry;
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
      const rawWidth = String(properties.width ?? '');
      const explicitWidth = /^\d+(\.\d+)?\s*(m)?$/.test(rawWidth) && Number.parseFloat(rawWidth) >= .5 && Number.parseFloat(rawWidth) <= 80;
      const width = explicitWidth ? Number.parseFloat(rawWidth) : ROAD_RENDERING.strokeWidthMeters;
      for (const coordinates of lines) {
        if (coordinates.length < 2) continue;
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const point of coordinates) {
          west = Math.min(west, point[0]); east = Math.max(east, point[0]);
          south = Math.min(south, point[1]); north = Math.max(north, point[1]);
        }
        // Anything beyond the maximum possible ramp length cannot be reached by
        // the solver. Reject it before projection, deduplication, or graph work.
        if (!windows.some(window => east >= window.west && west <= window.east && north >= window.south && south <= window.north)) continue;
        const pointsKey = coordinates.map(point => point.map(n => n.toFixed(7)).join(',')).join('/');
        const reversedKey = [...coordinates].reverse().map(point => point.map(n => n.toFixed(7)).join(',')).join('/');
        const layer = Number(properties.layer) || 0, brunnel = String(properties.brunnel || '');
        const key = `${layer}:${brunnel}:${width}:${pointsKey < reversedKey ? pointsKey : reversedKey}`;
        if (roadCache.has(key)) continue;
        roadCache.set(key, { coordinates, width, explicitWidth, roadClass: String(properties.class), layer, brunnel, key });
      }
    }
    // This cache only grows: chunk eviction and returning to a visited area do
    // not change the revision or rebuild/dispose any geometry.
    const nextSignature = `${roadCache.size}:${JSON.stringify(bridges)}`;
    if (nextSignature === signature) return false;
    signature = nextSignature;
    const roads = [...roadCache.values()];
    const paths: RoadPath[] = roads.map(road => ({
      layer: road.layer, brunnel: road.brunnel,
      points: road.coordinates.map(coordinate => {
        const p = MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]]);
        return new Vector3((p.x - origin.x) / scale, ROAD_RENDERING.surfaceHeightMeters, -(p.y - origin.y) / scale);
      }).filter((point, i, all) => i === 0 || Vector3.DistanceSquared(point, all[i - 1]) > .01),
    }));
    const elevatedPointCount = raiseBridgeApproaches(paths, bridges, origin, scale);
    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const drawnRoads: typeof roads = [];
    let segmentCount = 0;
    for (let p = 0; p < roads.length; p++) {
      const road = roads[p], points = paths[p].points;
      if (points.length < 2) continue;
      // The elevation solver follows the road graph from the modeled bridges.
      // Draw only its reached segments, including the final segment down to ground.
      const connectedSegments = points.slice(1).map((point, i) =>
        point.y > ROAD_RENDERING.surfaceHeightMeters + 1e-6 ||
        points[i].y > ROAD_RENDERING.surfaceHeightMeters + 1e-6);
      if (!connectedSegments.some(Boolean)) continue;
      drawnRoads.push(road);
      const vertexOffsets = new Int32Array(points.length);
      for (let i = 0; i < points.length; i++) {
        if (!connectedSegments[i - 1] && !connectedSegments[i]) continue;
        vertexOffsets[i] = positions.length / 3;
        const previous = points[Math.max(0, i - 1)], current = points[i], next = points[Math.min(points.length - 1, i + 1)];
        const incoming = i === 0 ? next.subtract(current) : current.subtract(previous);
        incoming.y = 0; incoming.normalize();
        const outgoing = i === points.length - 1 ? current.subtract(previous) : next.subtract(current);
        outgoing.y = 0; outgoing.normalize();
        const normalA = new Vector3(-incoming.z, 0, incoming.x), normalB = new Vector3(-outgoing.z, 0, outgoing.x);
        const sum = normalA.add(normalB);
        const miter = sum.lengthSquared() > .001 ? sum.normalize() : normalA;
        const halfWidth = road.width / 2;
        const distance = Math.min(halfWidth * 2, halfWidth / Math.max(.5, Math.abs(Vector3.Dot(miter, normalA))));
        const left = current.add(miter.scale(distance)), right = current.subtract(miter.scale(distance));
        positions.push(...left.asArray(), ...right.asArray());
        normals.push(0, 1, 0, 0, 1, 0);
      }
      for (let i = 0; i < connectedSegments.length; i++) {
        if (connectedSegments[i]) {
          const a = vertexOffsets[i], b = vertexOffsets[i + 1];
          indices.push(a, b, a + 1, a + 1, b, b + 1);
          segmentCount++;
        }
      }
    }
    if (!indices.length && mesh) {
      // A partial chunk batch must never replace a valid approach with nothing.
      return false;
    }
    scene.metadata = { ...scene.metadata, roads: {
      source: 'nyc-osm-snapshot', sourceLayer: 'roads', featureCount: drawnRoads.length,
      availableFeatureCount: roads.length, segmentCount, elevatedPointCount,
      persistence: 'retained-bridge-area-source-geometry', cachedFeatureCount: roadCache.size,
      scope: 'bridge-decks-and-connected-approaches', approachElevationMode: 'estimated-connected-road-grade',
      explicitWidthCount: drawnRoads.filter(road => road.explicitWidth).length,
      fallbackStrokeWidthMeters: ROAD_RENDERING.strokeWidthMeters, widthMode: 'cartographic-unless-explicit', laneCount: null,
      roadClasses: [...new Set(drawnRoads.map(road => road.roadClass))].sort(),
    } };
    if (!indices.length) {
      return false;
    }
    const previous = mesh;
    mesh = new Mesh('tile-roads', scene);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    // The merged mesh spans retained map regions. Let the shared map projection
    // clip it, rather than dropping the whole batch via Babylon camera culling.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.freezeWorldMatrix();
    if (previous) {
      const replacement = mesh;
      // Keep the previous GPU surface until its replacement has completed a render.
      const observer = scene.onAfterRenderObservable.add(() => {
        if (replacement.isDisposed()) {
          previous.dispose();
          scene.onAfterRenderObservable.remove(observer);
        } else if (replacement.isReady()) {
          previous.dispose();
          scene.onAfterRenderObservable.remove(observer);
          map.triggerRepaint();
        } else map.triggerRepaint();
      });
    }
    return true;
  };
}
