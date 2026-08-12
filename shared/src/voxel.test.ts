import { describe, it, expect } from "vitest";
import { VoxelWorld, CHUNK, AIR } from "./voxel";

describe("VoxelWorld storage", () => {
  it("get/set round-trips across chunk borders (incl. negatives)", () => {
    const w = new VoxelWorld();
    const pts: [number, number, number][] = [
      [0, 0, 0], [15, 15, 15], [16, 0, 0], [-1, 0, 0], [-17, 20, 33], [100, 5, -100],
    ];
    pts.forEach(([x, y, z], i) => w.set(x, y, z, i + 1));
    pts.forEach(([x, y, z], i) => expect(w.get(x, y, z)).toBe(i + 1));
    expect(w.get(500, 500, 500)).toBe(AIR);
  });
});

describe("raycast", () => {
  it("hits the first block along the ray with the entry face normal", () => {
    const w = new VoxelWorld();
    w.set(5, 0, 0, 3);
    const hit = w.raycast([0.5, 0.5, 0.5], [1, 0, 0], 20)!;
    expect([hit.x, hit.y, hit.z]).toEqual([5, 0, 0]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([-1, 0, 0]); // entered from -x side
    expect(hit.dist).toBeCloseTo(4.5, 1);
  });

  it("returns null past maxDist and hits diagonals", () => {
    const w = new VoxelWorld();
    w.set(5, 0, 0, 1);
    expect(w.raycast([0.5, 0.5, 0.5], [1, 0, 0], 3)).toBeNull();
    w.set(4, 4, 4, 1);
    const hit = w.raycast([0.5, 0.5, 0.5], [1, 1, 1], 20)!;
    expect([hit.x, hit.y, hit.z]).toEqual([4, 4, 4]);
  });

  it("hits the ground looking straight down", () => {
    const w = new VoxelWorld();
    w.set(2, 10, 2, 2);
    const hit = w.raycast([2.5, 14, 2.5], [0, -1, 0], 10)!;
    expect([hit.x, hit.y, hit.z]).toEqual([2, 10, 2]);
    expect(hit.ny).toBe(1); // top face
  });
});

describe("greedy cuboids", () => {
  it("merges a full flat 16x1x16 layer into ONE box", () => {
    const w = new VoxelWorld();
    for (let x = 0; x < CHUNK; x++) for (let z = 0; z < CHUNK; z++) w.set(x, 0, z, 1);
    const boxes = w.chunkCuboids("0,0,0");
    expect(boxes.length).toBe(1);
    expect(boxes[0]).toEqual({ x: 8, y: 0.5, z: 8, hx: 8, hy: 0.5, hz: 8 });
  });

  it("merges a solid cube and keeps separate islands separate", () => {
    const w = new VoxelWorld();
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) w.set(x, y, z, 1);
    w.set(10, 10, 10, 1);
    const boxes = w.chunkCuboids("0,0,0");
    expect(boxes.length).toBe(2);
    const big = boxes.find((b) => b.hx === 2)!;
    expect(big).toEqual({ x: 2, y: 2, z: 2, hx: 2, hy: 2, hz: 2 });
  });

  it("total merged volume equals the number of solid cells", () => {
    const w = new VoxelWorld();
    let cells = 0;
    // deterministic pseudo-random blob
    for (let x = 0; x < CHUNK; x++)
      for (let y = 0; y < 8; y++)
        for (let z = 0; z < CHUNK; z++)
          if ((x * 7 + y * 13 + z * 29) % 5 !== 0) {
            w.set(x, y, z, 1);
            cells++;
          }
    const vol = w
      .chunkCuboids("0,0,0")
      .reduce((s, b) => s + b.hx * 2 * (b.hy * 2) * (b.hz * 2), 0);
    expect(vol).toBe(cells);
  });
});

describe("serialize round trip", () => {
  it("survives RLE with multiple chunks and negative coords", () => {
    const w = new VoxelWorld();
    for (let x = -20; x < 20; x += 3) for (let z = -20; z < 20; z += 3) w.set(x, 12, z, ((x + z) % 5 + 5) % 5 + 1);
    const w2 = VoxelWorld.deserialize(w.serialize());
    for (let x = -20; x < 20; x += 3)
      for (let z = -20; z < 20; z += 3) expect(w2.get(x, 12, z)).toBe(w.get(x, 12, z));
    expect(w2.chunks.size).toBe(w.chunks.size);
  });
});
