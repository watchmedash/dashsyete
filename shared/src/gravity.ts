// 6-direction "cube planet" gravity. Every position belongs to a FACE of the
// cube (the dominant axis of the position vector); gravity pulls along that
// face's inward normal, so all six sides are walkable floors. Crossing an
// edge flips the dominant axis and the world rotates 90° under you.
//
// On classic maps (city / sky islands) up is always +Y and every formula
// below degenerates to the original flat-world math BIT-FOR-BIT:
// basis(+Y) = { t1: +X, t2: +Z }.

export type V3 = [number, number, number];

export const UP_Y: V3 = [0, 1, 0];

export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The face "up" (outward normal) for a position. `prev` adds hysteresis so
 * standing exactly on an edge doesn't flip-flop; `planet` false = always +Y. */
export function faceUp(p: V3, prev: V3 | null, planet: boolean): V3 {
  if (!planet) return UP_Y;
  const ax = Math.abs(p[0]);
  const ay = Math.abs(p[1]);
  const az = Math.abs(p[2]);
  const max = Math.max(ax, ay, az);
  if (prev) {
    const along = Math.abs(dot(p, prev));
    if (along + 0.6 >= max) return prev; // still (nearly) the dominant axis
  }
  if (ax >= ay && ax >= az) return [p[0] >= 0 ? 1 : -1, 0, 0];
  if (ay >= az) return [0, p[1] >= 0 ? 1 : -1, 0];
  return [0, 0, p[2] >= 0 ? 1 : -1];
}

/** Deterministic face tangents; up=+Y gives (t1,t2)=(+X,+Z) — the classic
 * frame, so yaw semantics are unchanged on flat maps and the top face. */
export function basis(up: V3): { t1: V3; t2: V3 } {
  const ref: V3 = Math.abs(up[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
  const t1 = cross(up, ref);
  const t2 = cross(t1, up);
  return { t1, t2 };
}

/** Aim/fire direction from face-local yaw+pitch (matches the flat formula
 * [sin·cos, sinPitch, cos·cos] when up=+Y). */
export function dirFromYawPitch(yaw: number, pitch: number, up: V3): V3 {
  const { t1, t2 } = basis(up);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [
    (t1[0] * sy + t2[0] * cy) * cp + up[0] * sp,
    (t1[1] * sy + t2[1] * cy) * cp + up[1] * sp,
    (t1[2] * sy + t2[2] * cy) * cp + up[2] * sp,
  ];
}

/** Quaternion of the face frame alone (local +Y → up, +Z → t2). */
export function quatFace(up: V3): [number, number, number, number] {
  const { t1, t2 } = basis(up);
  // rotation matrix with columns (t1, up, t2) → quaternion
  const m00 = t1[0], m01 = up[0], m02 = t2[0];
  const m10 = t1[1], m11 = up[1], m12 = t2[1];
  const m20 = t1[2], m21 = up[2], m22 = t2[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  return [x, y, z, w];
}

/** Full orientation: face frame + yaw spin about the face up. */
export function quatUpYaw(up: V3, yaw: number): [number, number, number, number] {
  const f = quatFace(up);
  const h = yaw / 2;
  const s = Math.sin(h);
  const a: [number, number, number, number] = [up[0] * s, up[1] * s, up[2] * s, Math.cos(h)];
  // a ⊗ f
  return [
    a[3] * f[0] + a[0] * f[3] + a[1] * f[2] - a[2] * f[1],
    a[3] * f[1] - a[0] * f[2] + a[1] * f[3] + a[2] * f[0],
    a[3] * f[2] + a[0] * f[1] - a[1] * f[0] + a[2] * f[3],
    a[3] * f[3] - a[0] * f[0] - a[1] * f[1] - a[2] * f[2],
  ];
}

/** Face-local yaw of a world-space forward direction (inverse of the yaw
 * part of dirFromYawPitch). */
export function yawFromDir(dir: V3, up: V3): number {
  const { t1, t2 } = basis(up);
  return Math.atan2(dot(dir, t1), dot(dir, t2));
}
