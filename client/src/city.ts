import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCityMap, tileToWorld, type CityMap } from "../../shared/src/cityMap";
import { MODEL_SCALES, TILE } from "../../shared/src/constants";
import { loadModel, preload } from "./assets";

export async function buildCity(scene: THREE.Scene): Promise<CityMap> {
  const map = buildCityMap();
  const span = map.size * TILE;

  // Sky dome: vertical gradient from a deep zenith blue to a hazy horizon.
  // The fog color matches the horizon so distance fade blends into the sky.
  {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1600, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x4f8fd8) },
          horizon: { value: new THREE.Color(0xbcd7ee) },
        },
        vertexShader:
          "varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;" +
          "void main(){ float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }",
      }),
    );
    scene.add(sky);
    scene.background = null;
    scene.fog = new THREE.Fog(0xbcd7ee, 350, 1100);
  }

  // Sea
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 3, span * 3),
    new THREE.MeshLambertMaterial({ color: 0x3577ad }),
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

  // Lighting (tuned for the MegaKit's PBR materials — Lambert-era values
  // read flat and dim on metallic-roughness surfaces)
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a5f6b, 1.7));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
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

  // Walkable colliders no prefab draws (building interior slabs, door
  // steps): render them for real — invisible floors read as FLOATING.
  for (const fb of map.floors) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(fb.hx * 2, fb.hy * 2, fb.hz * 2),
      new THREE.MeshLambertMaterial({ color: fb.color }),
    );
    // shrink a hair so it never z-fights the walls it touches
    slab.scale.multiplyScalar(0.995);
    slab.position.set(fb.x, fb.y, fb.z);
    slab.receiveShadow = true;
    scene.add(slab);
  }

  // Grass overlays (visual only — the physics ground is the slab below)
  for (const g of map.greens) {
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(g.x1 - g.x0, 0.04, g.z1 - g.z0),
      new THREE.MeshLambertMaterial({ color: g.color }),
    );
    lawn.position.set((g.x0 + g.x1) / 2, 0.02, (g.z0 + g.z1) / 2);
    lawn.receiveShadow = true;
    scene.add(lawn);
  }

  // Parked decor cars along the streets (colliders come from the shared sim)
  await Promise.all(
    map.parkedCars.map(async (pc) => {
      const obj = await loadModel("cars", pc.model);
      obj.position.set(pc.x, 0, pc.z);
      obj.rotation.y = (-pc.rot * Math.PI) / 2;
      obj.scale.setScalar(MODEL_SCALES.cars);
      scene.add(obj);
    }),
  );

  // Preload unique models, then instantiate all tiles
  const unique = new Map<string, { pack: string; model: string }>();
  for (const t of map.tiles) unique.set(`${t.pack}/${t.model}`, { pack: t.pack, model: t.model });
  await preload([...unique.values()]);

  // Batch repeated tiles into InstancedMeshes: one draw call per unique
  // mesh+material instead of one per tile (Street_2Lane alone repeats 150+×).
  type Tile = CityMap["tiles"][number];
  const groups = new Map<string, Tile[]>();
  for (const t of map.tiles) {
    const key = `${t.pack}/${t.model}/${t.scale ?? "d"}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(t);
  }

  const tileMatrix = (t: Tile): THREE.Matrix4 => {
    const scale = t.scale ?? MODEL_SCALES[t.pack] ?? 1;
    const m = new THREE.Matrix4().makeRotationY((-t.rot * Math.PI) / 2);
    m.scale(new THREE.Vector3(scale, scale, scale));
    m.setPosition(tileToWorld(t.gx, map.size), t.y ?? 0, tileToWorld(t.gz, map.size));
    return m; // T(tilePos) * RotY(-rot·π/2) * S(scale)
  };

  await Promise.all(
    [...groups.values()].map(async (tiles) => {
      const { pack, model } = tiles[0];
      if (tiles.length < 4) {
        // Rare models: keep the simple per-tile clone path.
        await Promise.all(
          tiles.map(async (t) => {
            const obj = await loadModel(t.pack, t.model);
            obj.position.set(tileToWorld(t.gx, map.size), t.y ?? 0, tileToWorld(t.gz, map.size));
            obj.rotation.y = (-t.rot * Math.PI) / 2;
            obj.scale.setScalar(t.scale ?? MODEL_SCALES[t.pack] ?? 1);
            scene.add(obj);
          }),
        );
        return;
      }
      // Load ONCE (loadModel already strips downtown vertex colors), then
      // instance each of the model's meshes across all tiles in the group.
      const proto = await loadModel(pack, model);
      proto.updateWorldMatrix(true, true);
      const meshes: THREE.Mesh[] = [];
      proto.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      const tileMats = tiles.map(tileMatrix);
      const inst = new THREE.Matrix4();
      const addInstanced = (
        geometry: THREE.BufferGeometry,
        material: THREE.Material | THREE.Material[],
        local: THREE.Matrix4 | null, // mesh-in-prototype matrix; null = already baked
      ) => {
        const im = new THREE.InstancedMesh(geometry, material, tiles.length);
        for (let i = 0; i < tileMats.length; i++) {
          if (local) inst.multiplyMatrices(tileMats[i], local);
          else inst.copy(tileMats[i]);
          im.setMatrixAt(i, inst);
        }
        im.instanceMatrix.needsUpdate = true;
        // flat road-marking decals must NOT cast shadows — a quad 2 mm above
        // the asphalt otherwise shadows the whole crossing dark
        im.castShadow = !model.startsWith("Decal_");
        im.receiveShadow = true;
        scene.add(im);
      };

      // Modular kit prefabs (buildings) carry dozens of sub-meshes sharing a
      // handful of materials — merge same-material meshes into one geometry
      // (baked into prototype-root space) so each becomes ONE InstancedMesh.
      const byMaterial = new Map<string, THREE.Mesh[]>();
      for (const mesh of meshes) {
        if (Array.isArray(mesh.material)) {
          addInstanced(mesh.geometry, mesh.material, mesh.matrixWorld); // multi-material: instance as-is
          continue;
        }
        let g = byMaterial.get(mesh.material.uuid);
        if (!g) byMaterial.set(mesh.material.uuid, (g = []));
        g.push(mesh);
      }
      for (const group of byMaterial.values()) {
        if (group.length === 1) {
          addInstanced(group[0].geometry, group[0].material, group[0].matrixWorld);
          continue;
        }
        const merged = mergeGeometries(
          group.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)),
        );
        if (merged) {
          addInstanced(merged, group[0].material, null);
        } else {
          // attribute-set mismatch — fall back to per-mesh instancing
          for (const m of group) addInstanced(m.geometry, m.material, m.matrixWorld);
        }
      }
    }),
  );

  return map;
}
