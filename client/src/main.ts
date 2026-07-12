import * as THREE from "three";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(10, 8, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x6b7a4f, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 80, 30);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ color: 0x8a9b5c }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshLambertMaterial({ color: 0x3be26b }),
);
box.position.y = 1.5;
scene.add(box);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  box.rotation.y += 0.02;
  renderer.render(scene, camera);
});
