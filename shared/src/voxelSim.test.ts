import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { VoxelWorld } from "./voxel";
import { PLANET_R } from "./skyMap";
import type { InputState } from "./protocol";

const IDLE_INPUT: InputState = {
  seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0,
  jump: false, sprint: false, fire: false, nade: false, swap: false,
};

let sim: Sim;
const world = new VoxelWorld();

beforeAll(async () => {
  // Sim.create() boots the DEFAULT map — the cube planet (R=22) — so these
  // tests exercise real planet-mode physics. Extra test platform: a floating
  // 12x12 slab ABOVE the top face (y dominates → up stays +Y there).
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, 60, z, 3);
  sim = await Sim.create();
  for (const k of world.chunks.keys()) sim.setVoxelChunk(k, world.chunkCuboids(k));
  sim.step(); // query pipeline sees colliders only after a step
});

describe("voxel terrain physics (top-face frame)", () => {
  it("a character stands on a voxel platform", () => {
    sim.addChar("v1", 6, 6, 0, 61);
    for (let i = 0; i < 90; i++) sim.step();
    const s = sim.getState("v1");
    expect(s.p[1]).toBeGreaterThan(61.5);
    expect(s.p[1]).toBeLessThan(62.1);
    expect(s.grounded).toBe(true);
    sim.removeChar("v1");
  });

  it("breaking the floor under a character drops them", () => {
    sim.addChar("v2", 9, 9, 0, 61);
    for (let i = 0; i < 60; i++) sim.step();
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, 60, z, 0);
    for (const k of world.chunks.keys()) sim.setVoxelChunk(k, world.chunkCuboids(k));
    for (let i = 0; i < 60; i++) sim.step();
    const s = sim.getState("v2");
    expect(s.p[1]).toBeLessThan(58); // free fall below the old floor
    sim.removeChar("v2");
  });
});

describe("cube-planet gravity", () => {
  it("a character stands on the +X SIDE face (gravity pulls -X)", () => {
    // foot on the +X face surface (x = +R), around face-local (2,3)
    sim.addChar("side", PLANET_R, 3.5, 0, 2.5);
    for (let i = 0; i < 120; i++) sim.step();
    const s = sim.getState("side");
    expect(sim.getUp("side")).toEqual([1, 0, 0]);
    // capsule center hovers just off the face plane at x = +R
    expect(s.p[0]).toBeGreaterThan(PLANET_R + 0.5);
    expect(s.p[0]).toBeLessThan(PLANET_R + 1.2);
    expect(s.grounded).toBe(true);
    // and stays at its face-local spot (didn't slide down world -Y)
    expect(Math.abs(s.p[1] - 2.5)).toBeLessThan(0.6);
    sim.removeChar("side");
  });

  it("a character stands on the BOTTOM face (upside down)", () => {
    sim.addChar("bot", 2.5, 2.5, 0, -PLANET_R);
    for (let i = 0; i < 120; i++) sim.step();
    const s = sim.getState("bot");
    expect(sim.getUp("bot")).toEqual([0, -1, 0]);
    expect(s.p[1]).toBeLessThan(-PLANET_R - 0.5); // hanging below the cube
    expect(s.grounded).toBe(true);
    sim.removeChar("bot");
  });

  it("walking over an edge rolls gravity onto the next face (no falling off)", () => {
    // start on the TOP face near the +X edge, walk straight +X until the
    // face flips, then stop and settle
    sim.addChar("edge", 17.5, 2.5, Math.PI / 2, PLANET_R); // yaw π/2 = face +X
    for (let i = 0; i < 60; i++) sim.step(); // settle
    let flipped = false;
    for (let i = 0; i < 420 && !flipped; i++) {
      sim.setInput("edge", { ...IDLE_INPUT, seq: i + 1, moveZ: 1, yaw: Math.PI / 2, sprint: true });
      sim.step();
      flipped = sim.getUp("edge")[0] === 1;
    }
    expect(flipped).toBe(true); // crossed the edge → gravity rolled to +X
    for (let i = 0; i < 120; i++) {
      sim.setInput("edge", { ...IDLE_INPUT, seq: 1000 + i, yaw: Math.PI / 2 });
      sim.step();
    }
    const s = sim.getState("edge");
    // grounded on the +X face, hovering just off its plane
    expect(sim.getUp("edge")).toEqual([1, 0, 0]);
    expect(s.grounded).toBe(true);
    expect(s.p[0]).toBeGreaterThan(PLANET_R + 0.4);
    expect(s.p[0]).toBeLessThan(PLANET_R + 1.3);
    sim.removeChar("edge");
  });
});
