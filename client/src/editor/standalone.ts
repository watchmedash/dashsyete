// Standalone entry for the map builder (Electron / vite.editor.config.ts).
// Deliberately imports NOTHING from the game shell: no main.ts, no net.ts,
// no websocket, no version-handshake reload — game rebuilds never touch it.
import * as THREE from "three";
import { startEditor } from "./editor";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

startEditor(renderer, camera);
