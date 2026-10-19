import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import { MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl';
import { PLACES } from './config';
import { attachPrecomputedWorld } from './precomputed-world';
import type { TileManifest } from './tile-data';

// Share MapLibre's WebGL context and transform a small, metre-based Babylon scene.
export function createPlacesLayer(manifest: TileManifest): CustomLayerInterface {
  let engine: Engine, scene: Scene, camera: Camera;
  let stopWorldUpdates = () => {};
  let settlingFrames = 0;
  let mapRepaint = () => {};
  const origin = MercatorCoordinate.fromLngLat(PLACES[0].coordinates);
  const scale = origin.meterInMercatorCoordinateUnits();
  const world = Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.FromEulerAngles(Math.PI / 2, 0, 0), new Vector3(origin.x, origin.y, origin.z));
  return {
    id: 'babylon-places', type: 'custom', renderingMode: '3d',
    onAdd(_map, gl) {
      mapRepaint = () => _map.triggerRepaint();
      engine = new Engine(gl, true, { useHighPrecisionMatrix: true }, true);
      // Avoid competing with MapLibre for shared WebGL uniform buffer bindings.
      engine.disableUniformBuffers = true;
      scene = new Scene(engine);
      scene.autoClear = false;
      scene.autoClearDepthAndStencil = false;
      scene.detachControl();
      scene.beforeRender = () => engine.wipeCaches(true);
      camera = new Camera('map-camera', Vector3.Zero(), scene);
      new HemisphericLight('daylight', new Vector3(-1, 2, -1), scene).intensity = 1.2;
      const orange = new StandardMaterial('terracotta', scene);
      orange.diffuseColor = Color3.FromHexString('#e36d41');
      orange.emissiveColor = Color3.FromHexString('#6c2815');
      orange.specularColor = Color3.Black();
      const cream = new StandardMaterial('porcelain', scene);
      cream.diffuseColor = Color3.FromHexString('#fff8ea');
      PLACES.forEach((place, i) => {
        const p = MercatorCoordinate.fromLngLat(place.coordinates);
        const x = (p.x - origin.x) / scale, z = -(p.y - origin.y) / scale;
        const stem = MeshBuilder.CreateCylinder(`stem-${i}`, { height: 55, diameterTop: 6, diameterBottom: 2, tessellation: 16 }, scene);
        stem.position.set(x, 28, z); stem.material = orange;
        const head = MeshBuilder.CreateSphere(`pin-${i}`, { diameter: 29, segments: 20 }, scene);
        head.position.set(x, 64, z); head.material = orange;
        const dot = MeshBuilder.CreateSphere(`center-${i}`, { diameter: 12, segments: 16 }, scene);
        dot.position.set(x, 78, z); dot.material = cream;
        const ring = MeshBuilder.CreateTorus(`ring-${i}`, { diameter: 46, thickness: 3, tessellation: 40 }, scene);
        ring.position.set(x, 2, z); ring.material = orange;
      });
      if (import.meta.env.DEV) Object.assign(window, { __atlasScene: scene });
      const repaint = () => {
        settlingFrames = 3;
        _map.triggerRepaint();
        scene.executeWhenReady(() => _map.triggerRepaint());
      };
      stopWorldUpdates = attachPrecomputedWorld(scene, _map, manifest, repaint);
      scene.executeWhenReady(() => _map.triggerRepaint());
    },
    render(_gl, args) {
      camera.freezeProjectionMatrix(world.multiply(Matrix.FromArray(args.defaultProjectionData.mainMatrix)));
      scene.render(false);
      // New geometry/materials need a frame immediately, then another after shader compilation.
      if (settlingFrames > 0 || !scene.isReady()) {
        settlingFrames = Math.max(0, settlingFrames - 1);
        mapRepaint();
      }
    },
    onRemove() { stopWorldUpdates(); scene?.dispose(); engine?.dispose(); },
  };
}
