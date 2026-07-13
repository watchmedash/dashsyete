import * as THREE from "three";
import { buildCityMap, tileToWorld, type CityMap } from "../../shared/src/cityMap";
import { MODEL_SCALES, TILE } from "../../shared/src/constants";
import { loadModel, preload } from "./assets";

export async function buildCity(scene: THREE.Scene): Promise<CityMap> {
  const map = buildCityMap();
  const span = map.size * TILE;

  // Sea
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 3, span * 3),
    new THREE.MeshLambertMaterial({ color: 0x2e6fa3 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = map.waterY;
  scene.add(water);

  // Island / islet / bridge-deck slabs
  for (const g of map.grounds) {
    const wdt = g.x1 - g.x0;
    const dep = g.z1 - g.z0;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(wdt, 2.4, dep),
      new THREE.MeshLambertMaterial({ color: g.color }),
    );
    // VISUAL top sits 5 cm below the physics top (y=0): road lanes render a
    // couple of cm above y=0 and bridge decks exactly at it — a coplanar slab
    // z-fights them (the "blinking roads/bridges"). Physics is unaffected.
    slab.position.set((g.x0 + g.x1) / 2, -1.25, (g.z0 + g.z1) / 2);
    slab.receiveShadow = true;
    scene.add(slab);
  }

  // Lighting
  scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x6b7a4f, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(180, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  // Without bias, a shadow map stretched over the whole 576 m world
  // self-shadows every surface with diagonal stripe artifacts (shadow acne).
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 2.5;
  const cam = sun.shadow.camera;
  cam.left = -span / 2;
  cam.right = span / 2;
  cam.top = span / 2;
  cam.bottom = -span / 2;
  cam.far = 800;
  scene.add(sun);

  // Preload unique models, then instantiate all tiles
  const unique = new Map<string, { pack: string; model: string }>();
  for (const t of map.tiles) unique.set(`${t.pack}/${t.model}`, { pack: t.pack, model: t.model });
  await preload([...unique.values()]);

  await Promise.all(
    map.tiles.map(async (t) => {
      const obj = await loadModel(t.pack, t.model);
      obj.position.set(tileToWorld(t.gx, map.size), t.y ?? 0, tileToWorld(t.gz, map.size));
      obj.rotation.y = (-t.rot * Math.PI) / 2;
      obj.scale.setScalar(t.scale ?? MODEL_SCALES[t.pack] ?? 1);
      scene.add(obj);
    }),
  );

  return map;
}
