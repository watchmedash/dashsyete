// HOW shared/src/modelFootprints.ts IS GENERATED
//
// The GLB bounding boxes are measured in a running browser (three.js does the
// parsing). With `npm run dev` up, open http://localhost:5173 and run the
// snippet below in the devtools console, then paste the output between the
// braces of MODEL_FOOTPRINTS. Add any new map models to the `models` object.
//
// (This file is documentation, not an executable script — the measurement
// needs a browser context.)

export const SNIPPET = `
(async () => {
  const { loadModel } = await import('/src/assets.ts');
  const THREE = await import('/@id/three');
  const models = {
    roads: ['road-straight', /* ... every model the map uses ... */],
  };
  const lines = [];
  for (const [pack, list] of Object.entries(models))
    for (const m of list) {
      const obj = await loadModel(pack, m);
      const b = new THREE.Box3().setFromObject(obj);
      const f = (n) => +n.toFixed(3);
      lines.push(\`  "\${pack}/\${m}": { cx: \${f((b.min.x+b.max.x)/2)}, cy: \${f((b.min.y+b.max.y)/2)}, cz: \${f((b.min.z+b.max.z)/2)}, hx: \${f((b.max.x-b.min.x)/2)}, hy: \${f((b.max.y-b.min.y)/2)}, hz: \${f((b.max.z-b.min.z)/2)} },\`);
    }
  console.log(lines.join('\\n'));
})();
`;
