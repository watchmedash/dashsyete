import * as THREE from "three";
import { buildCityMap, tileToWorld } from "../../shared/src/cityMap";
import { MODEL_SCALES, TILE } from "../../shared/src/constants";
import { loadModel, preload } from "./assets";

export async function buildCity(scene: THREE.Scene): Promise<void> {
  const map = buildCityMap();
  const span = map.size * TILE;

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshLambertMaterial({ color: 0x5b5f66 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // Water strip beyond the east wall (harbor side)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshLambertMaterial({ color: 0x2e6fa3 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(span, -0.1, 0);
  scene.add(water);

  // Lighting
  scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x6b7a4f, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(120, 180, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -span / 2;
  cam.right = span / 2;
  cam.top = span / 2;
  cam.bottom = -span / 2;
  cam.far = 500;
  scene.add(sun);

  // Preload unique models, then instantiate all tiles
  const unique = new Map<string, { pack: string; model: string }>();
  for (const t of map.tiles) unique.set(`${t.pack}/${t.model}`, { pack: t.pack, model: t.model });
  await preload([...unique.values()]);

  await Promise.all(
    map.tiles.map(async (t) => {
      const obj = await loadModel(t.pack, t.model);
      obj.position.set(tileToWorld(t.gx, map.size), 0, tileToWorld(t.gz, map.size));
      obj.rotation.y = (-t.rot * Math.PI) / 2;
      obj.scale.setScalar(t.scale ?? MODEL_SCALES[t.pack] ?? 1);
      scene.add(obj);
    }),
  );
}
