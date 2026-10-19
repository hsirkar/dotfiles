import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MercatorCoordinate, type Map as LibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import { createBridgeUpdater } from '../../src/bridge';
import { createRoadUpdater } from '../../src/roads';
import { setWorldFeatures } from '../../src/world-input';
import { PLACES } from '../../src/config';

async function main() {
  const [input, coastline, output] = process.argv.slice(2);
  await mkdir(output, { recursive: true });
  const features: MapGeoJSONFeature[] = [];
  for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) if (line) features.push(JSON.parse(line));
  const coast = JSON.parse(await readFile(coastline, 'utf8'));
  features.push(...coast.features.filter((feature: MapGeoJSONFeature) => feature.properties.kind === 'ocean'));
  const map = { getZoom: () => 15, triggerRepaint: () => {} } as unknown as LibreMap;
  setWorldFeatures(map, features);
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const origin = MercatorCoordinate.fromLngLat(PLACES[0].coordinates);
  const scale = origin.meterInMercatorCoordinateUnits();
  console.log(`Preparing bridge meshes from ${features.length.toLocaleString()} complete OSM features`);
  createBridgeUpdater(scene, map, origin, scale)();
  createRoadUpdater(scene, map, origin, scale)();
  const bridges = scene.metadata.bridges;
  if (!bridges?.['Queensboro Bridge']) throw new Error('Bridge preparation did not produce Queensboro');
  const entries: Record<string, unknown>[] = [];
  const bounds = (positions: ArrayLike<number>) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i=0; i<positions.length; i+=3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i+2]); maxZ = Math.max(maxZ, positions[i+2]);
    }
    const sw = new MercatorCoordinate(origin.x+minX*scale, origin.y-maxZ*scale).toLngLat();
    const ne = new MercatorCoordinate(origin.x+maxX*scale, origin.y-minZ*scale).toLngLat();
    return [sw.lng, sw.lat, ne.lng, ne.lat];
  };
  async function save(key: string, category: string, meshes: {name: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array; material: StandardMaterial}[]) {
    const buffers: Buffer[] = [];
    let offset = 0;
    const descriptions = meshes.map(mesh => {
      const description: Record<string, unknown> = { name: mesh.name, vertices: mesh.positions.length/3, indexCount: mesh.indices.length,
        material: { color: mesh.material.diffuseColor.asArray(), emissive: mesh.material.emissiveColor.asArray(), unlit: mesh.material.disableLighting } };
      for (const attribute of ['positions','normals','indices'] as const) {
        description[attribute] = { offset, length: mesh[attribute].length };
        const data = Buffer.from(mesh[attribute].buffer, mesh[attribute].byteOffset, mesh[attribute].byteLength);
        buffers.push(data); offset += data.byteLength;
      }
      return description;
    });
    let bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const mesh of meshes) { const b=bounds(mesh.positions); bbox=[Math.min(bbox[0],b[0]), Math.min(bbox[1],b[1]),Math.max(bbox[2],b[2]),Math.max(bbox[3],b[3])]; }
    const filename = `${key}.bin`;
    await writeFile(join(output, filename), Buffer.concat(buffers));
    entries.push({ key, category, file: filename, bounds: bbox, meshes: descriptions });
  }
  for (const root of scene.transformNodes) {
    const meshes = root.getChildMeshes().filter(mesh => mesh instanceof Mesh) as Mesh[];
    if (!meshes.length) continue;
    const serialized = meshes.map(mesh => {
      const matrix = mesh.computeWorldMatrix(true);
      const positions = Float32Array.from(mesh.getVerticesData('position')!);
      const normals = Float32Array.from(mesh.getVerticesData('normal')!);
      for (let i=0; i<positions.length; i+=3) {
        const p = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), matrix);
        const n = Vector3.TransformNormal(Vector3.FromArray(normals, i), matrix).normalize();
        positions.set(p.asArray(), i); normals.set(n.asArray(), i);
      }
      return { name: mesh.name, positions, normals, indices: Uint32Array.from(mesh.getIndices()!), material: mesh.material as StandardMaterial };
    });
    await save(root.name, 'bridge', serialized);
  }
  const roads = scene.getMeshByName('tile-roads') as Mesh;
  if (!roads) throw new Error('No approach geometry was generated');
  const positions = roads.getVerticesData('position')!, normals = roads.getVerticesData('normal')!, indices = roads.getIndices()!;
  const cells = new Map<string, { positions: number[]; normals: number[]; indices: number[]; vertices: Map<number,number> }>();
  for (let i=0; i<indices.length; i+=3) {
    const triangle = [indices[i], indices[i+1], indices[i+2]];
    const x = triangle.reduce((sum,id)=>sum+positions[id*3],0)/3;
    const z = triangle.reduce((sum,id)=>sum+positions[id*3+2],0)/3;
    const key = `approaches-${Math.floor(x/2000)}_${Math.floor(z/2000)}`;
    if (!cells.has(key)) cells.set(key, {positions:[],normals:[],indices:[],vertices:new Map()});
    const cell = cells.get(key)!;
    for (const id of triangle) {
      if (!cell.vertices.has(id)) {
        cell.vertices.set(id, cell.positions.length/3);
        cell.positions.push(positions[id*3],positions[id*3+1],positions[id*3+2]);
        cell.normals.push(normals[id*3],normals[id*3+1],normals[id*3+2]);
      }
      cell.indices.push(cell.vertices.get(id)!);
    }
  }
  for (const [key,cell] of cells) await save(key,'approaches',[{name:key,positions:Float32Array.from(cell.positions),normals:Float32Array.from(cell.normals),indices:Uint32Array.from(cell.indices),material:roads.material as StandardMaterial}]);
  await writeFile(join(output,'manifest.json'), JSON.stringify({origin:PLACES[0].coordinates, bridges, roads:scene.metadata.roads, entries}));
  console.log(`Prepared ${Object.keys(bridges).length} bridges and ${cells.size} approach mesh chunks`);
  scene.dispose(); engine.dispose();
}
main().catch(error => { console.error(error); process.exitCode=1; });
