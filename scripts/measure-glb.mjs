// Measure GLB bounding boxes in Node (no browser needed): parses the glTF
// JSON chunk and pushes each mesh primitive's POSITION accessor min/max box
// through the node hierarchy transforms. Prints MODEL_FOOTPRINTS lines.
//
//   node scripts/measure-glb.mjs <pack-dir-under-assets> [modelName...]
//   node scripts/measure-glb.mjs --trunk <pack> [modelName...]
//     --trunk: footprint of the LOWER HALF of the model only (reads the
//     vertex buffers). Roof overhangs otherwise inflate building colliders
//     into invisible walls at street level.
//
// Skinned meshes are measured in bind pose — fine for footprint purposes.
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

function parseGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  // BIN chunk follows the JSON chunk
  const binStart = 20 + jsonLen;
  let bin = null;
  if (binStart < buf.length) {
    const binLen = buf.readUInt32LE(binStart);
    bin = buf.subarray(binStart + 8, binStart + 8 + binLen);
  }
  return { json, bin };
}

function parseGlbJson(buf) {
  return parseGlb(buf).json;
}

/** Iterate world-space POSITION vertices of every primitive. */
function* vertices(gltf, bin) {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const stack = gltf.scenes[gltf.scene ?? 0].nodes.map((i) => [i, I]);
  while (stack.length) {
    const [idx, parent] = stack.pop();
    const n = gltf.nodes[idx];
    const m = matMul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        const bv = gltf.bufferViews[acc.bufferView];
        const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const stride = bv.byteStride ?? 12;
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride;
          yield apply(m, [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
        }
      }
    }
    for (const c of n.children ?? []) stack.push([c, m]);
  }
}

/** Bbox of vertices in the lower `frac` of the model's height. */
function measureTrunk(file, frac = 0.55) {
  const buf = readFileSync(file);
  const { json, bin } = parseGlb(buf);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of vertices(json, bin)) {
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  const cut = minY + (maxY - minY) * frac;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices(json, bin)) {
    if (v[1] > cut) continue;
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  }
  // keep the FULL height (walls reach the roof) but the trunk's x/z extent
  min[1] = minY;
  max[1] = maxY;
  return { min, max };
}

function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // column-major TRS
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function measure(file) {
  const gltf = parseGlbJson(readFileSync(file));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (idx, parent) => {
    const n = gltf.nodes[idx];
    const m = matMul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (let c = 0; c < 8; c++) {
          const corner = [
            c & 1 ? acc.max[0] : acc.min[0],
            c & 2 ? acc.max[1] : acc.min[1],
            c & 4 ? acc.max[2] : acc.min[2],
          ];
          const w = apply(m, corner);
          for (let i = 0; i < 3; i++) {
            if (w[i] < min[i]) min[i] = w[i];
            if (w[i] > max[i]) max[i] = w[i];
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const idx of gltf.scenes[gltf.scene ?? 0].nodes) visit(idx, I);
  return { min, max };
}

const argv = process.argv.slice(2);
const trunk = argv[0] === "--trunk";
const [pack, ...names] = trunk ? argv.slice(1) : argv;
const dir = join("client", "public", "assets", pack);
const files = names.length
  ? names.map((n) => join(dir, `${n}.glb`))
  : readdirSync(dir).filter((f) => f.endsWith(".glb")).map((f) => join(dir, f));
for (const f of files) {
  const { min, max } = trunk ? measureTrunk(f) : measure(f);
  const r = (n) => +n.toFixed(3);
  const name = basename(f, ".glb");
  console.log(
    `  "${pack}/${name}": { cx: ${r((min[0] + max[0]) / 2)}, cy: ${r((min[1] + max[1]) / 2)}, cz: ${r((min[2] + max[2]) / 2)}, hx: ${r((max[0] - min[0]) / 2)}, hy: ${r((max[1] - min[1]) / 2)}, hz: ${r((max[2] - min[2]) / 2)} },`,
  );
}
