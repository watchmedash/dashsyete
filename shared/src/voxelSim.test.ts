import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { VoxelWorld } from "./voxel";
import { PLANET_R } from "./skyMap";
import { FLY_MAX_ALT } from "./character";
import type { InputState } from "./protocol";

const IDLE_INPUT: InputState = {
  seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0,
  jump: false, sprint: false, fire: false, nade: false, swap: false,
};

let sim: Sim;
const world = new VoxelWorld();

// The floating test platform must sit ABOVE the planet surface (y > R, y
// dominant → up stays +Y there and it's outside every terrain chunk).
const PLAT_Y = PLANET_R + 48;

beforeAll(async () => {
  // Sim.create() boots the DEFAULT map — the cube planet — so these tests
  // exercise real planet-mode physics. Extra test platform: a floating
  // 12x12 slab high above the top face.
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, PLAT_Y, z, 3);
  sim = await Sim.create();
  for (const k of world.chunks.keys()) sim.setVoxelChunk(k, world.chunkCuboids(k));
  sim.step(); // query pipeline sees colliders only after a step
});

describe("voxel terrain physics (top-face frame)", () => {
  it("a character stands on a voxel platform", () => {
    sim.addChar("v1", 6, 6, 0, PLAT_Y + 1);
    for (let i = 0; i < 90; i++) sim.step();
    const s = sim.getState("v1");
    expect(s.p[1]).toBeGreaterThan(PLAT_Y + 1.5);
    expect(s.p[1]).toBeLessThan(PLAT_Y + 2.1);
    expect(s.grounded).toBe(true);
    sim.removeChar("v1");
  });

  it("breaking the floor under a character drops them", () => {
    sim.addChar("v2", 9, 9, 0, PLAT_Y + 1);
    for (let i = 0; i < 60; i++) sim.step();
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, PLAT_Y, z, 0);
    for (const k of world.chunks.keys()) sim.setVoxelChunk(k, world.chunkCuboids(k));
    for (let i = 0; i < 60; i++) sim.step();
    const s = sim.getState("v2");
    expect(s.p[1]).toBeLessThan(PLAT_Y - 2); // free fall below the old floor
    sim.removeChar("v2");
  });
});

// Terrain adds mountains: find the surface plane along an axis by scanning
// outward from the shell (returns the FOOT coordinate on the surface).
function surfacePlane(axis: 0 | 1 | 2, sign: 1 | -1, a: number, b: number): number {
  const vox = sim.vox!;
  for (let k = 14; k >= 0; k--) {
    const c: [number, number, number] = [0, 0, 0];
    c[axis] = (sign > 0 ? PLANET_R - 1 : -PLANET_R) + sign * k;
    c[(axis + 1) % 3] = a;
    c[(axis + 2) % 3] = b;
    if (vox.solid(c[0], c[1], c[2])) return sign > 0 ? c[axis] + 1 : c[axis];
  }
  return sign * PLANET_R;
}

describe("flight + fall damage (top face = grassland)", () => {
  beforeAll(() => {
    // re-lay the platform (the drop-floor test above destroyed it)
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, PLAT_Y, z, 3);
    for (const k of world.chunks.keys()) sim.setVoxelChunk(k, world.chunkCuboids(k));
    sim.step();
  });

  it("double-jump toggles flight (no gravity), another double-jump drops", () => {
    // the platform is far above the top face → up = +Y → grassland (fly)
    sim.addChar("fly", 6, 6, 0, PLAT_Y + 1);
    for (let i = 0; i < 60; i++) sim.step(); // settle grounded
    let seq = 0;
    const press = (jump: boolean) => {
      sim.setInput("fly", { ...IDLE_INPUT, seq: ++seq, jump });
      sim.step();
    };
    press(true); // first jump (opens the double-jump window)
    for (let i = 0; i < 5; i++) press(false);
    press(true); // second jump inside the window → flight ON
    expect(sim.getFly("fly")).toBe(true);
    const h0 = sim.getState("fly").p[1];
    for (let i = 0; i < 60; i++) press(false); // hover: no gravity
    const h1 = sim.getState("fly").p[1];
    expect(Math.abs(h1 - h0)).toBeLessThan(0.2);
    // double-jump again → flight OFF → falls back to the platform
    press(true);
    for (let i = 0; i < 3; i++) press(false);
    press(true);
    expect(sim.getFly("fly")).toBe(false);
    for (let i = 0; i < 90; i++) press(false);
    expect(sim.getState("fly").grounded).toBe(true);
    sim.removeChar("fly");
  });

  it("a hard landing records its impact speed (fall damage feed)", () => {
    // spawn 9 m above the platform: impact ≈ √(2·25·8) ≈ 20 m/s
    sim.addChar("drop", 3, 3, 0, PLAT_Y + 10);
    sim.consumeImpact("drop");
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.getState("drop").grounded).toBe(true);
    const impact = sim.consumeImpact("drop");
    expect(impact).toBeGreaterThan(15);
    expect(impact).toBeLessThan(31);
    // consuming clears it
    expect(sim.consumeImpact("drop")).toBe(0);
    sim.removeChar("drop");
  });

  it("flight is BOUNDED: altitude ceiling + the face's own width", () => {
    const sx = PLANET_R - 30;
    const gy = surfacePlane(1, 1, 4, sx); // top face at z=4, x=sx
    sim.addChar("fb", sx + 0.5, 4.5, Math.PI / 2, gy);
    let seq = 0;
    const tick = (jump: boolean, mz = 0) => {
      sim.setInput("fb", { ...IDLE_INPUT, seq: ++seq, jump, moveZ: mz, yaw: Math.PI / 2 });
      sim.step();
    };
    for (let i = 0; i < 30; i++) tick(false); // settle
    tick(true);
    for (let i = 0; i < 4; i++) tick(false);
    tick(true); // double-jump → flight
    expect(sim.getFly("fb")).toBe(true);
    // hold jump: climb — altitude must cap at the ceiling
    for (let i = 0; i < 300; i++) tick(true);
    expect(sim.getState("fb").p[1] - PLANET_R).toBeLessThan(FLY_MAX_ALT + 2);
    // bolt toward the +X edge: stopped at the face bound, up still +Y
    for (let i = 0; i < 600; i++) tick(true, 1);
    expect(sim.getState("fb").p[0]).toBeLessThan(PLANET_R + 0.5);
    expect(sim.getUp("fb")).toEqual([0, 1, 0]);
    sim.removeChar("fb");
  });
});

describe("cube-planet gravity", () => {
  it("a character stands on the +X SIDE face (gravity pulls -X)", () => {
    // foot on the +X face TERRAIN surface around face-local (y=2, z=3)
    const gx = surfacePlane(0, 1, 2, 3);
    sim.addChar("side", gx, 3.5, 0, 2.5);
    for (let i = 0; i < 120; i++) sim.step();
    const s = sim.getState("side");
    expect(sim.getUp("side")).toEqual([1, 0, 0]);
    // capsule center hovers just off the local surface plane
    expect(s.p[0]).toBeGreaterThan(gx + 0.5);
    expect(s.p[0]).toBeLessThan(gx + 1.3);
    expect(s.grounded).toBe(true);
    // and stays at its face-local spot (didn't slide down world -Y)
    expect(Math.abs(s.p[1] - 2.5)).toBeLessThan(0.8);
    sim.removeChar("side");
  });

  it("a character stands on the BOTTOM face (upside down)", () => {
    const gy = surfacePlane(1, -1, 2, 2); // (axis+1)%3=z=2, (axis+2)%3=x=2
    sim.addChar("bot", 2.5, 2.5, 0, gy);
    for (let i = 0; i < 120; i++) sim.step();
    const s = sim.getState("bot");
    expect(sim.getUp("bot")).toEqual([0, -1, 0]);
    expect(s.p[1]).toBeLessThan(gy - 0.5); // hanging below the local surface
    expect(s.grounded).toBe(true);
    sim.removeChar("bot");
  });

  it("walking over an edge rolls gravity onto the next face (no falling off)", () => {
    // start on the TOP face near the +X edge and just KEEP SPRINTING +X:
    // over the cliff, gravity must roll to the side face and the character
    // must land and keep running there (never lost to space).
    const ex = PLANET_R - 22; // ~22 blocks from the +X edge (scales with R)
    const gy = surfacePlane(1, 1, 2, ex); // top face at z=2, x=ex
    sim.addChar("edge", ex + 0.5, 2.5, Math.PI / 2, gy); // yaw π/2 = face +X
    for (let i = 0; i < 60; i++) sim.step(); // settle
    let sawFlip = false;
    let sawGroundedOffTop = false;
    for (let i = 0; i < 500; i++) {
      sim.setInput("edge", { ...IDLE_INPUT, seq: i + 1, moveZ: 1, yaw: Math.PI / 2, sprint: true });
      sim.step();
      const u = sim.getUp("edge");
      if (u[1] !== 1) sawFlip = true;
      if (u[1] !== 1 && sim.getState("edge").grounded) sawGroundedOffTop = true;
    }
    expect(sawFlip).toBe(true); // gravity left the top face
    expect(sawGroundedOffTop).toBe(true); // and the character LANDED on another face
    // still near the planet (never flung into space)
    const s = sim.getState("edge");
    expect(Math.hypot(s.p[0], s.p[1], s.p[2])).toBeLessThan(PLANET_R * 2);
    sim.removeChar("edge");
  });
});
