import { describe, it, expect } from "vitest";
import { buildSkyWorld, FACES, PLANET_R, B_GRASS } from "./skyMap";
import { faceUp, basis, dirFromYawPitch, quatUpYaw, yawFromDir, UP_Y, type V3 } from "./gravity";

const sky = buildSkyWorld();
const R = PLANET_R;

describe("cube planet generation", () => {
  it("is deterministic for the same seed", () => {
    expect(buildSkyWorld().world.serialize()).toBe(sky.world.serialize());
    expect(buildSkyWorld(7).world.serialize()).not.toBe(sky.world.serialize());
  });

  it("every face center has a grass surface with empty space above it", () => {
    for (const f of FACES) {
      // scan OUTWARD from the shell for the terrain surface at face center
      const shell = (n: number) => (n > 0 ? R - 1 : -R);
      let top: [number, number, number] | null = null;
      for (let k = 14; k >= 0; k--) {
        const c: [number, number, number] = [
          f.n[0] !== 0 ? shell(f.n[0]) + f.n[0] * k : 0,
          f.n[1] !== 0 ? shell(f.n[1]) + f.n[1] * k : 0,
          f.n[2] !== 0 ? shell(f.n[2]) + f.n[2] * k : 0,
        ];
        if (sky.world.solid(c[0], c[1], c[2])) {
          top = c;
          break;
        }
      }
      expect(top, `face ${f.n.join(",")}`).not.toBeNull();
      expect(sky.world.get(top![0], top![1], top![2])).toBe(B_GRASS);
      expect(sky.world.solid(top![0] + f.n[0], top![1] + f.n[1], top![2] + f.n[2])).toBe(false);
    }
  });

  it("spawns exist on ALL six faces, standing on solid ground", () => {
    expect(sky.spawns.length).toBeGreaterThanOrEqual(12);
    const facesHit = new Set<string>();
    for (const s of sky.spawns) {
      const up = faceUp([s.x, s.y, s.z], null, true);
      facesHit.add(up.join(","));
      // solid just under the foot along -up, air just above along +up
      const under = [Math.floor(s.x - up[0] * 0.5), Math.floor(s.y - up[1] * 0.5), Math.floor(s.z - up[2] * 0.5)];
      const over = [Math.floor(s.x + up[0] * 0.5), Math.floor(s.y + up[1] * 0.5), Math.floor(s.z + up[2] * 0.5)];
      expect(sky.world.solid(under[0], under[1], under[2]), `under ${s.x},${s.y},${s.z}`).toBe(true);
      expect(sky.world.solid(over[0], over[1], over[2]), `over ${s.x},${s.y},${s.z}`).toBe(false);
    }
    expect(facesHit.size).toBe(6);
  });

  it("crates cover all faces and most of the item table", () => {
    expect(sky.crateSpawns.length).toBeGreaterThanOrEqual(12);
    const weapons = new Set(sky.crateSpawns.map((c) => c.weapon));
    expect(weapons.size).toBeGreaterThanOrEqual(6);
  });
});

describe("face gravity math", () => {
  it("degenerates to +Y off the planet", () => {
    expect(faceUp([50, 3, -20], null, false)).toEqual([0, 1, 0]);
    const { t1, t2 } = basis(UP_Y);
    expect(t1).toEqual([1, 0, 0]);
    expect(t2).toEqual([0, 0, 1]);
  });

  it("picks the dominant axis as up on the planet", () => {
    expect(faceUp([5, 30, 2], null, true)).toEqual([0, 1, 0]);
    expect(faceUp([5, -30, 2], null, true)).toEqual([0, -1, 0]);
    expect(faceUp([30, 5, 2], null, true)).toEqual([1, 0, 0]);
    expect(faceUp([2, 5, -30], null, true)).toEqual([0, 0, -1]);
  });

  it("hysteresis keeps the previous face near an edge", () => {
    const prev: V3 = [0, 1, 0];
    expect(faceUp([21.7, 21.5, 0], prev, true)).toEqual(prev); // barely across
    expect(faceUp([26, 20, 0], prev, true)).toEqual([1, 0, 0]); // clearly across
  });

  it("dirFromYawPitch matches the classic formula on the top face", () => {
    const d = dirFromYawPitch(0.7, 0.3, UP_Y);
    expect(d[0]).toBeCloseTo(Math.sin(0.7) * Math.cos(0.3));
    expect(d[1]).toBeCloseTo(Math.sin(0.3));
    expect(d[2]).toBeCloseTo(Math.cos(0.7) * Math.cos(0.3));
  });

  it("yawFromDir inverts dirFromYawPitch on every face", () => {
    for (const up of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as V3[]) {
      for (const yaw of [-2.1, 0, 0.5, 2.9]) {
        const d = dirFromYawPitch(yaw, 0, up);
        let got = yawFromDir(d, up);
        let diff = got - yaw;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        expect(Math.abs(diff)).toBeLessThan(1e-6);
      }
    }
  });

  it("quatUpYaw rotates local +Y onto the face up", () => {
    for (const up of [[0, -1, 0], [1, 0, 0], [0, 0, -1]] as V3[]) {
      const q = quatUpYaw(up, 1.1);
      // rotate (0,1,0) by q
      const [x, y, z, w] = q;
      const uy: V3 = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
      expect(uy[0]).toBeCloseTo(up[0]);
      expect(uy[1]).toBeCloseTo(up[1]);
      expect(uy[2]).toBeCloseTo(up[2]);
    }
  });
});
