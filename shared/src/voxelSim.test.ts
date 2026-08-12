import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { VoxelWorld } from "./voxel";
import type { InputState } from "./protocol";

const IDLE_INPUT: InputState = {
  seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0,
  jump: false, sprint: false, fire: false, nade: false, swap: false,
};

let sim: Sim;
const world = new VoxelWorld();

beforeAll(async () => {
  // a 12x12 platform at y=30 far from the city map's own colliders
  for (let x = 500; x < 512; x++) for (let z = 500; z < 512; z++) world.set(x, 30, z, 3);
  sim = await Sim.create();
  sim.loadVoxelWorld(world);
  sim.step(); // query pipeline sees colliders only after a step
});

describe("voxel terrain physics", () => {
  it("a character stands on a voxel chunk", () => {
    sim.addChar("v1", 506, 506, 0, 31);
    for (let i = 0; i < 90; i++) sim.step();
    const s = sim.getState("v1");
    // capsule center rests just above the block top at y=31
    expect(s.p[1]).toBeGreaterThan(31.5);
    expect(s.p[1]).toBeLessThan(32.1);
    expect(s.grounded).toBe(true);
    sim.removeChar("v1");
  });

  it("breaking the floor under a character drops them", () => {
    sim.addChar("v2", 509, 509, 0, 31);
    for (let i = 0; i < 60; i++) sim.step();
    // remove the whole platform chunk region under them
    for (let x = 500; x < 512; x++) for (let z = 500; z < 512; z++) world.set(x, 30, z, 0);
    for (const k of new Set([...world.chunks.keys()])) sim.setVoxelChunk(k, world.chunkCuboids(k));
    for (let i = 0; i < 60; i++) sim.step();
    const s = sim.getState("v2");
    expect(s.p[1]).toBeLessThan(28); // in free fall below the old floor
    sim.removeChar("v2");
  });

  it("a placed block wall stops movement", () => {
    // rebuild the platform + a wall ahead
    for (let x = 500; x < 512; x++) for (let z = 500; z < 512; z++) world.set(x, 30, z, 3);
    for (let y = 31; y < 34; y++) for (let x = 500; x < 512; x++) world.set(x, y, 508, 6);
    for (const k of new Set([...world.chunks.keys()])) sim.setVoxelChunk(k, world.chunkCuboids(k));
    sim.step();
    sim.addChar("v3", 506, 505, 0, 31);
    for (let i = 0; i < 120; i++) {
      sim.setInput("v3", { ...IDLE_INPUT, seq: i + 1, moveZ: 1, yaw: 0 }); // +z toward the wall
      sim.step();
    }
    const s = sim.getState("v3");
    expect(s.p[2]).toBeLessThan(508); // stopped at the wall, didn't pass it
    expect(s.p[2]).toBeGreaterThan(506.5); // but did walk up to it
    sim.removeChar("v3");
  });
});
