import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadModel } from "../assets";
import { CATALOG } from "./catalog";
import "./editor.css";

const STORAGE_KEY = "dash-editor-map";

interface Piece {
  model: string;
  x: number;
  y: number;
  z: number;
  rot: 0 | 1 | 2 | 3;
}
interface Placed extends Piece {
  obj: THREE.Group;
}

export function startEditor(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  // ---- Scene ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const grid = new THREE.GridHelper(198, 132, 0x666a70, 0x7b8087); // 1.5 m cells
  scene.add(grid);

  camera.position.set(24, 28, 24);
  camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  // ---- State ----
  const placed: Placed[] = [];
  let brush: string | null = null; // active model name
  let ghost: THREE.Group | null = null;
  let ghostFor: string | null = null; // model the current ghost was built for
  let rot: 0 | 1 | 2 | 3 = 0;
  let snap = 1.5;
  let height = 0;
  let selected: Placed | null = null;
  let selectBox: THREE.Box3Helper | null = null;
  const ghostPos = new THREE.Vector3();
  let ghostValid = false;

  // ---- UI ----
  const toolbar = document.createElement("div");
  toolbar.id = "ed-toolbar";
  toolbar.innerHTML = `
    <button id="ed-save">Save</button>
    <button id="ed-load">Load</button>
    <button id="ed-export">Export</button>
    <button id="ed-clear">Clear</button>
    <span class="ed-spacer"></span>
    <span class="ed-stat">pieces <b id="ed-count">0</b></span>
    <span class="ed-stat">snap <b id="ed-snap">1.5</b> m</span>
    <span class="ed-stat">height <b id="ed-height">0.00</b> m</span>`;
  document.body.appendChild(toolbar);

  const palette = document.createElement("div");
  palette.id = "ed-palette";
  const filter = document.createElement("input");
  filter.id = "ed-filter";
  filter.placeholder = "Filter models...";
  const list = document.createElement("div");
  list.id = "ed-list";
  for (const { category, models } of CATALOG) {
    const cat = document.createElement("div");
    cat.className = "ed-cat";
    cat.textContent = category;
    list.appendChild(cat);
    for (const m of models) {
      const item = document.createElement("div");
      item.className = "ed-item";
      item.textContent = m;
      item.dataset.model = m;
      item.addEventListener("click", () => setBrush(m));
      list.appendChild(item);
    }
  }
  const hint = document.createElement("div");
  hint.id = "ed-hint";
  hint.textContent = "Click a model, then click the ground to place. R rotate · Q/E height · 1/2/3 snap · Esc select mode · Del remove";
  palette.append(filter, list, hint);
  document.body.appendChild(palette);

  const countEl = document.getElementById("ed-count")!;
  const snapEl = document.getElementById("ed-snap")!;
  const heightEl = document.getElementById("ed-height")!;

  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    let visibleInCat = 0;
    let lastCat: HTMLElement | null = null;
    for (const el of Array.from(list.children) as HTMLElement[]) {
      if (el.className === "ed-cat") {
        if (lastCat) lastCat.style.display = visibleInCat ? "" : "none";
        lastCat = el;
        visibleInCat = 0;
      } else {
        const show = !q || el.dataset.model!.toLowerCase().includes(q);
        el.style.display = show ? "" : "none";
        if (show) visibleInCat++;
      }
    }
    if (lastCat) lastCat.style.display = visibleInCat ? "" : "none";
  });

  function refreshHud() {
    countEl.textContent = String(placed.length);
    snapEl.textContent = String(snap);
    heightEl.textContent = height.toFixed(2);
  }

  // ---- Brush / ghost ----
  function setBrush(model: string | null) {
    brush = model;
    clearSelection();
    for (const el of list.querySelectorAll(".ed-item")) {
      el.classList.toggle("active", (el as HTMLElement).dataset.model === model);
    }
    if (ghost) {
      scene.remove(ghost);
      ghost = null;
      ghostFor = null;
    }
    if (!model) return;
    const want = model;
    void loadModel("downtown", want).then((g) => {
      if (brush !== want) return; // brush changed while loading
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const wasArray = Array.isArray(o.material);
          const mats = (wasArray ? o.material : [o.material]) as THREE.Material[];
          const clones = mats.map((m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.5;
            c.depthWrite = false;
            return c;
          });
          o.material = wasArray ? clones : clones[0];
        }
      });
      ghost = g;
      ghostFor = want;
      ghost.visible = ghostValid;
      updateGhostTransform();
      scene.add(ghost);
    });
  }

  function updateGhostTransform() {
    if (!ghost) return;
    ghost.position.copy(ghostPos);
    ghost.rotation.y = -rot * (Math.PI / 2);
    ghost.visible = ghostValid;
  }

  // ---- Selection ----
  function clearSelection() {
    selected = null;
    if (selectBox) {
      scene.remove(selectBox);
      selectBox = null;
    }
  }

  function select(p: Placed) {
    clearSelection();
    selected = p;
    const box = new THREE.Box3().setFromObject(p.obj);
    selectBox = new THREE.Box3Helper(box, 0xffcc00);
    scene.add(selectBox);
  }

  function refreshSelectBox() {
    if (!selected) return;
    const p = selected;
    select(p); // rebuild the box around the (possibly rotated) object
  }

  function removeSelected() {
    if (!selected) return;
    scene.remove(selected.obj);
    const i = placed.indexOf(selected);
    if (i >= 0) placed.splice(i, 1);
    clearSelection();
    refreshHud();
    autoSave();
  }

  // ---- Placement ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  function pickGround(ev: PointerEvent | MouseEvent): boolean {
    ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    plane.constant = -height; // plane at y = height
    if (!raycaster.ray.intersectPlane(plane, hit)) return false;
    ghostPos.set(Math.round(hit.x / snap) * snap, height, Math.round(hit.z / snap) * snap);
    return true;
  }

  async function addPiece(piece: Piece): Promise<void> {
    const obj = await loadModel("downtown", piece.model);
    obj.position.set(piece.x, piece.y, piece.z);
    obj.rotation.y = -piece.rot * (Math.PI / 2);
    scene.add(obj);
    placed.push({ ...piece, obj });
    refreshHud();
  }

  function placeAtGhost() {
    if (!brush || !ghostValid) return;
    void addPiece({ model: brush, x: ghostPos.x, y: ghostPos.y, z: ghostPos.z, rot }).then(autoSave);
  }

  function pickPlaced(ev: MouseEvent): Placed | null {
    ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(placed.map((p) => p.obj), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o) {
      const found = placed.find((p) => p.obj === o);
      if (found) return found;
      o = o.parent;
    }
    return null;
  }

  // ---- Persistence ----
  function serialize(): string {
    return JSON.stringify({
      version: 1,
      pieces: placed.map((p) => ({ model: p.model, x: p.x, y: p.y, z: p.z, rot: p.rot })),
    });
  }

  function autoSave() {
    try {
      localStorage.setItem(STORAGE_KEY, serialize());
    } catch {
      // storage full/unavailable — editor keeps working in-memory
    }
  }

  function clearAll() {
    for (const p of placed) scene.remove(p.obj);
    placed.length = 0;
    clearSelection();
    refreshHud();
  }

  async function loadFromJson(json: string): Promise<void> {
    let data: { version?: number; pieces?: Piece[] };
    try {
      data = JSON.parse(json);
    } catch {
      return;
    }
    if (!Array.isArray(data.pieces)) return;
    clearAll();
    for (const p of data.pieces) {
      if (typeof p.model !== "string") continue;
      await addPiece({
        model: p.model,
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        z: Number(p.z) || 0,
        rot: (((Number(p.rot) | 0) % 4) + 4) % 4 as 0 | 1 | 2 | 3,
      });
    }
  }

  document.getElementById("ed-save")!.addEventListener("click", autoSave);
  document.getElementById("ed-load")!.addEventListener("click", () => {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) void loadFromJson(json);
  });
  document.getElementById("ed-export")!.addEventListener("click", () => {
    const blob = new Blob([serialize()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "custom-map.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("ed-clear")!.addEventListener("click", () => {
    if (confirm("Remove all placed pieces?")) {
      clearAll();
      autoSave();
    }
  });
  setInterval(autoSave, 30_000);

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) void loadFromJson(saved);

  // ---- Input ----
  renderer.domElement.addEventListener("pointermove", (ev) => {
    ghostValid = pickGround(ev);
    updateGhostTransform();
  });

  // Distinguish click from orbit-drag: place only if the pointer barely moved.
  let downX = 0;
  let downY = 0;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    downX = ev.clientX;
    downY = ev.clientY;
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (ev.button !== 0) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) return;
    if (brush) {
      ghostValid = pickGround(ev);
      updateGhostTransform();
      placeAtGhost();
    } else {
      const p = pickPlaced(ev);
      if (p) select(p);
      else clearSelection();
    }
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    switch (ev.key) {
      case "1":
        snap = 0.75;
        break;
      case "2":
        snap = 1.5;
        break;
      case "3":
        snap = 3;
        break;
      case "q":
      case "Q":
        height = Math.max(0, +(height - 0.25).toFixed(2));
        break;
      case "e":
      case "E":
        height = +(height + 0.25).toFixed(2);
        break;
      case "r":
      case "R":
        if (brush) {
          rot = ((rot + 1) % 4) as 0 | 1 | 2 | 3;
          updateGhostTransform();
        } else if (selected) {
          selected.rot = ((selected.rot + 1) % 4) as 0 | 1 | 2 | 3;
          selected.obj.rotation.y = -selected.rot * (Math.PI / 2);
          refreshSelectBox();
          autoSave();
        }
        break;
      case "Escape":
        setBrush(null);
        break;
      case "Delete":
      case "Backspace":
        removeSelected();
        break;
      default:
        return;
    }
    refreshHud();
    ev.preventDefault();
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  refreshHud();

  // ---- Render loop ----
  renderer.setAnimationLoop(() => {
    controls.update();
    // ghost may finish loading after the last pointermove
    if (ghost && ghostFor === brush) updateGhostTransform();
    renderer.render(scene, camera);
  });
}
