import * as THREE from "three";

/** Map builder (?editor) — full implementation in progress. */
export function startEditor(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  void renderer;
  void camera;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#171c2b;color:#f4f7ff;font:16px system-ui">Map editor loading…</div>`,
  );
}
