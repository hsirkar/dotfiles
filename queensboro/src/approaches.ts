import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MercatorCoordinate } from 'maplibre-gl';
import { ROAD_RENDERING, BRIDGE_APPROACHES } from './config';

export type RoadPath = {
  points: Vector3[];
  layer: number;
  brunnel: string;
};
export type BridgeDeck = {
  start: number[];
  end: number[];
  widthMeters: number | null;
  deckSurfaceMeters: number;
  upperDeckSurfaceMeters?: number;
};
type Node = {
  point: Vector3;
  layer: number;
  underground: boolean;
  edges: { to: number; distance: number }[];
  ends: { tangent: Vector3; bridge: boolean }[];
  potential: number;
  sourceHeight: number;
  fixed: boolean;
};
type QueueItem = { node: number; potential: number; sourceHeight: number };

// Follow road connections, rather than lifting every street near a bridge.
// Coordinates/layers come from OSM; grades and deck elevations remain visualization estimates.
export function raiseBridgeApproaches(paths: RoadPath[], bridges: BridgeDeck[], origin: MercatorCoordinate, scale: number) {
  if (!bridges.length) return 0;
  const { sampleSpacingMeters: spacing, nodeSnapMeters: snap, maxGrade } = BRIDGE_APPROACHES;
  const local = (coordinate: number[]) => {
    const p = MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]]);
    return new Vector3((p.x - origin.x) / scale, ROAD_RENDERING.surfaceHeightMeters, -(p.y - origin.y) / scale);
  };
  const decks = bridges.map(bridge => ({ ...bridge, a: local(bridge.start), b: local(bridge.end) }));
  // Only bridge lines need extra seed vertices. Build the approach graph from the
  // original OSM vertices; tessellating every city street made this needlessly large.
  for (const path of paths) {
    if (path.brunnel !== 'bridge' || !path.points.length) continue;
    const nearby = decks.some(deck => path.points.some((point, i) => {
      if (!i) return false;
      const previous = path.points[i - 1];
      return Math.max(point.x, previous.x) >= Math.min(deck.a.x, deck.b.x) - 40 &&
        Math.min(point.x, previous.x) <= Math.max(deck.a.x, deck.b.x) + 40 &&
        Math.max(point.z, previous.z) >= Math.min(deck.a.z, deck.b.z) - 40 &&
        Math.min(point.z, previous.z) <= Math.max(deck.a.z, deck.b.z) + 40;
    }));
    if (!nearby) continue;
    const points: Vector3[] = [];
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const count = Math.max(1, Math.ceil(Vector3.Distance(a, b) / spacing));
      for (let j = 0; j < count; j++) points.push(Vector3.Lerp(a, b, j / count));
    }
    points.push(path.points[path.points.length - 1]);
    path.points = points;
  }
  const nodes: Node[] = [], buckets = new Map<string, number[]>();
  const key = (x: number, z: number) => `${x},${z}`;
  const cell = (point: Vector3) => [Math.floor(point.x / snap), Math.floor(point.z / snap)];
  const addNode = (point: Vector3, path: RoadPath) => {
    const [x, z] = cell(point), underground = path.brunnel === 'tunnel' || path.layer < 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const index of buckets.get(key(x + dx, z + dz)) || []) {
        const node = nodes[index];
        if (node.layer === path.layer && node.underground === underground && Vector3.DistanceSquared(node.point, point) < snap * snap) return index;
      }
    }
    const index = nodes.length;
    nodes.push({ point, layer: path.layer, underground, edges: [], ends: [], potential: 0, sourceHeight: 0, fixed: false });
    const bucket = key(x, z);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(index);
    return index;
  };
  const connect = (a: number, b: number) => {
    if (a === b) return;
    const distance = Math.max(.1, Vector3.Distance(nodes[a].point, nodes[b].point));
    nodes[a].edges.push({ to: b, distance }); nodes[b].edges.push({ to: a, distance });
  };
  const pathNodes = paths.map(path => path.points.map(point => addNode(point, path)));
  paths.forEach((path, p) => {
    const indices = pathNodes[p];
    for (let i = 1; i < indices.length; i++) connect(indices[i - 1], indices[i]);
    if (indices.length < 2) return;
    for (const i of [0, indices.length - 1]) {
      const next = i === 0 ? 1 : i - 1;
      nodes[indices[i]].ends.push({ tangent: path.points[next].subtract(path.points[i]).normalize(), bridge: path.brunnel === 'bridge' });
    }
  });
  // A way can change layer at its endpoint. Join only aligned endpoints, so streets
  // passing beneath an elevated crossing do not acquire the bridge's elevation.
  nodes.forEach((node, index) => {
    if (!node.ends.length || node.underground) return;
    const [x, z] = cell(node.point);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const otherIndex of buckets.get(key(x + dx, z + dz)) || []) {
        const other = nodes[otherIndex];
        if (otherIndex <= index || other.underground || other.layer === node.layer || !other.ends.length || Vector3.DistanceSquared(node.point, other.point) > snap * snap) continue;
        if (node.ends.some(a => other.ends.some(b => !(a.bridge && b.bridge) && Math.abs(Vector3.Dot(a.tangent, b.tangent)) > .85))) connect(index, otherIndex);
      }
    }
  });
  const queue: QueueItem[] = [];
  const push = (item: QueueItem) => {
    queue.push(item);
    let i = queue.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (queue[parent].potential >= item.potential) break;
      queue[i] = queue[parent]; i = parent;
    }
    queue[i] = item;
  };
  const pop = () => {
    const top = queue[0], last = queue.pop()!;
    if (queue.length) {
      let i = 0;
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].potential > queue[child].potential) child++;
        if (queue[child].potential <= last.potential) break;
        queue[i] = queue[child]; i = child;
      }
      queue[i] = last;
    }
    return top;
  };
  for (const bridge of decks) {
    const start = bridge.a, end = bridge.b, axis = end.subtract(start).normalize();
    const length = Vector3.Distance(start, end), across = new Vector3(-axis.z, 0, axis.x);
    const halfWidth = (bridge.widthMeters || ROAD_RENDERING.strokeWidthMeters) / 2 + 8;
    const seeds: { node: number; layer: number }[] = [];
    paths.forEach((path, p) => {
      if (path.brunnel !== 'bridge' || path.layer < 0) return;
      path.points.forEach((point, i) => {
        const delta = point.subtract(start), along = Vector3.Dot(delta, axis);
        if (along < -4 || along > length + 4 || Math.abs(Vector3.Dot(delta, across)) > halfWidth) return;
        const a = path.points[Math.max(0, i - 1)], b = path.points[Math.min(path.points.length - 1, i + 1)];
        if (Math.abs(Vector3.Dot(b.subtract(a).normalize(), axis)) > .8) seeds.push({ node: pathNodes[p][i], layer: path.layer });
      });
    });
    if (!seeds.length) continue;
    const lowerLayer = Math.min(...seeds.map(seed => seed.layer));
    for (const seed of seeds) {
      const surface = seed.layer > lowerLayer && bridge.upperDeckSurfaceMeters ? bridge.upperDeckSurfaceMeters : bridge.deckSurfaceMeters;
      const height = surface + .15 - ROAD_RENDERING.surfaceHeightMeters;
      const node = nodes[seed.node];
      if (height > node.potential) { node.potential = height; node.sourceHeight = height; }
      node.fixed = true;
    }
  }
  nodes.forEach((node, index) => {
    if (node.fixed) push({ node: index, potential: node.potential, sourceHeight: node.sourceHeight });
  });
  // Smoothstep has a peak derivative of 1.5. Scale the falloff to cap the estimated grade.
  const falloff = maxGrade / 1.5;
  while (queue.length) {
    const item = pop(), current = nodes[item.node];
    if (item.potential < current.potential) continue;
    for (const edge of current.edges) {
      const target = nodes[edge.to], potential = item.potential - edge.distance * falloff;
      if (target.fixed || target.underground || potential <= target.potential) continue;
      target.potential = potential; target.sourceHeight = item.sourceHeight;
      push({ node: edge.to, potential, sourceHeight: item.sourceHeight });
    }
  }
  let elevatedPoints = 0;
  paths.forEach((path, p) => {
    const elevated: Vector3[] = [];
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const from = nodes[pathNodes[p][i - 1]], to = nodes[pathNodes[p][i]];
      const reached = from.potential > 0 || to.potential > 0;
      // Smooth only the approaches that will actually be drawn.
      const count = reached ? Math.max(1, Math.ceil(Vector3.Distance(a, b) / spacing)) : 1;
      for (let j = 0; j < count; j++) {
        const fraction = j / count, point = Vector3.Lerp(a, b, fraction);
        const potential = from.potential + (to.potential - from.potential) * fraction;
        const height = from.sourceHeight && to.sourceHeight
          ? from.sourceHeight + (to.sourceHeight - from.sourceHeight) * fraction
          : Math.max(from.sourceHeight, to.sourceHeight);
        if (potential > 0 && height > 0) {
          const t = Math.min(1, potential / height);
          point.y += height * t * t * (3 - 2 * t);
          elevatedPoints++;
        }
        elevated.push(point);
      }
    }
    if (path.points.length) {
      const last = path.points[path.points.length - 1].clone(), node = nodes[pathNodes[p][path.points.length - 1]];
      if (node.potential > 0) {
        const t = Math.min(1, node.potential / node.sourceHeight);
        last.y += node.sourceHeight * t * t * (3 - 2 * t);
        elevatedPoints++;
      }
      elevated.push(last);
    }
    path.points = elevated;
  });
  return elevatedPoints;
}
