import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Map as LibreMap } from 'maplibre-gl';
import { assetUrl, cachedResponse, type TileManifest } from './tile-data';

type Attribute = { offset: number; length: number };
type Description = { name: string; vertices: number; indexCount: number; positions: Attribute; normals: Attribute; indices: Attribute; material: { color: number[]; emissive: number[]; unlit: boolean } };
type Entry = { key: string; category: string; file: string; bounds: number[]; meshes: Description[] };
type World = { bridges: Record<string, unknown>; roads: Record<string,unknown>; entries: Entry[] };

// Navigation only selects static meshes. Graph solving and vertex construction
// happen once in the offline tile build, never in a pan/zoom callback.
export function attachPrecomputedWorld(scene: Scene, map: LibreMap, manifest: TileManifest, repaint: () => void) {
  const root = new URL('.', assetUrl(manifest.world)).href;
  const controller = new AbortController();
  const loaded = new Map<string, Mesh[]>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  let world: World | undefined;
  let generation = 0;
  const visible = (entry: Entry, padding = .015) => {
    if (map.getZoom() < 12) return false;
    const b = map.getBounds();
    return entry.bounds[2] >= b.getWest()-padding && entry.bounds[0] <= b.getEast()+padding && entry.bounds[3] >= b.getSouth()-padding && entry.bounds[1] <= b.getNorth()+padding;
  };
  const visibility = () => {
    for (const entry of world?.entries || []) {
      const enabled = visible(entry);
      for (const mesh of loaded.get(entry.key) || []) if (mesh.isEnabled() !== enabled) mesh.setEnabled(enabled);
    }
  };
  async function load(entry: Entry) {
    pending.add(entry.key);
    if (scene.metadata?.world) scene.metadata.world.pendingChunks = pending.size;
    try {
      const bytes = await (await cachedResponse(new URL(entry.file, root).href, controller.signal)).arrayBuffer();
      if (controller.signal.aborted || scene.isDisposed) return;
      const meshes: Mesh[] = [];
      const parent = entry.category === 'bridge' ? new TransformNode(entry.key, scene) : undefined;
      for (const description of entry.meshes) {
        const mesh = new Mesh(description.name, scene);
        const data = new VertexData();
        data.positions = new Float32Array(bytes, description.positions.offset, description.positions.length);
        data.normals = new Float32Array(bytes, description.normals.offset, description.normals.length);
        data.indices = new Uint32Array(bytes, description.indices.offset, description.indices.length);
        data.applyToMesh(mesh);
        const material = new StandardMaterial(description.name+'-material', scene);
        material.diffuseColor = Color3.FromArray(description.material.color);
        material.emissiveColor = Color3.FromArray(description.material.emissive);
        material.specularColor = Color3.Black();
        material.disableLighting = description.material.unlit;
        material.backFaceCulling = false;
        mesh.material = material; mesh.parent = parent || null;
        mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
        mesh.freezeWorldMatrix(); mesh.setEnabled(visible(entry)); meshes.push(mesh);
      }
      loaded.set(entry.key, meshes);
      generation++;
      scene.metadata.world = { mode: 'precomputed', generation, loadedChunks: loaded.size, pendingChunks: pending.size };
      repaint();
    } catch (error) { if (!controller.signal.aborted) { failed.add(entry.key); console.warn('Bridge mesh unavailable:', error); } }
    finally { pending.delete(entry.key); if (scene.metadata?.world) scene.metadata.world.pendingChunks = pending.size; }
  }
  const update = () => {
    visibility();
    // Bound concurrent fetch/uploads. Completion fills any remaining visible slots.
    for (const entry of world?.entries || []) if (visible(entry, .025) && !loaded.has(entry.key) && !pending.has(entry.key) && !failed.has(entry.key) && pending.size < 3) void load(entry).then(() => { if (!controller.signal.aborted) update(); });
  };
  const moveend = () => { failed.clear(); update(); };
  map.on('moveend', moveend);
  // Visibility only: does not load data, construct vertices, or rebuild graphs.
  map.on('move', visibility);
  void (async () => {
    try {
      world = await (await cachedResponse(assetUrl(manifest.world), controller.signal)).json() as World;
      if (controller.signal.aborted || scene.isDisposed) return;
      scene.metadata = { ...scene.metadata, bridges: world.bridges, bridge: world.bridges['Queensboro Bridge'], roads: world.roads, world: { mode: 'precomputed', generation, loadedChunks: 0, pendingChunks: 0 } };
      update();
    } catch (error) { if (!controller.signal.aborted) console.error('Precomputed world unavailable:', error); }
  })();
  return () => { controller.abort(); map.off('moveend', moveend); map.off('move', visibility); };
}
