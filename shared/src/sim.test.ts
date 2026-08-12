import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { WALK_SPEED, SPRINT_SPEED, JUMP_VEL, GRAVITY, CHAR_CENTER_Y } from "./character";
import type { InputState } from "./protocol";

// Tests run on a floating platform far outside the city so they don't depend
// on map geometry (the map is exercised by cityMap.test.ts + probes).
const PX = 4; // small x/z: y must DOMINATE so planet-mode gravity stays +Y here
const PZ = 4;
const PLATFORM_TOP = 500.5;

function makeInput(over: Partial<InputState> = {}): InputState {
  return { seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false, ...over };
}

async function platformSim(): Promise<Sim> {
  const sim = await Sim.create();
  // NOTE: must be a FIXED box — the Rapier character controller refuses to
  // slide along kinematic ground (movement computes to zero above ~4 m/s).
  sim.addStaticBox({ x: 12, y: 0.5, z: 12 }, PX, 500, PZ);
  return sim;
}

function spawnOnPlatform(sim: Sim, id: string, dx = 0, dz = 0): void {
  sim.addChar(id, 0, 0, 0);
  sim.setState(id, [PX + dx, PLATFORM_TOP + CHAR_CENTER_Y + 0.05, PZ + dz], [0, 0, 0, 1], [0, 0, 0]);
  for (let i = 0; i < 30; i++) sim.step(); // settle onto the platform
}

describe("character controller", () => {
  it("walks at ~WALK_SPEED and sprints at ~SPRINT_SPEED", async () => {
    const sim = await platformSim();
    spawnOnPlatform(sim, "me");
    sim.setInput("me", makeInput({ moveZ: 1 }));
    for (let i = 0; i < 60; i++) sim.step();
    let v = sim.getState("me").v;
    expect(Math.hypot(v[0], v[2])).toBeGreaterThan(WALK_SPEED * 0.9);
    expect(Math.hypot(v[0], v[2])).toBeLessThan(WALK_SPEED * 1.1);
    expect(v[2]).toBeGreaterThan(0); // yaw 0, moveZ 1 => +z

    sim.setInput("me", makeInput({ moveZ: 1, sprint: true }));
    for (let i = 0; i < 60; i++) sim.step();
    v = sim.getState("me").v;
    expect(Math.hypot(v[0], v[2])).toBeGreaterThan(SPRINT_SPEED * 0.9);
    expect(Math.hypot(v[0], v[2])).toBeLessThan(SPRINT_SPEED * 1.1);
  });

  it("stops quickly when input releases", async () => {
    const sim = await platformSim();
    spawnOnPlatform(sim, "me");
    sim.setInput("me", makeInput({ moveZ: 1, sprint: true }));
    for (let i = 0; i < 60; i++) sim.step();
    sim.setInput("me", makeInput());
    for (let i = 0; i < 30; i++) sim.step(); // 0.5 s
    const v = sim.getState("me").v;
    expect(Math.hypot(v[0], v[2])).toBeLessThan(0.5);
  });

  it("jumps to roughly the analytic apex height", async () => {
    const sim = await platformSim();
    spawnOnPlatform(sim, "me");
    const restY = sim.getState("me").p[1];
    sim.setInput("me", makeInput({ jump: true }));
    sim.step();
    sim.setInput("me", makeInput());
    let maxY = restY;
    for (let i = 0; i < 60; i++) {
      sim.step();
      maxY = Math.max(maxY, sim.getState("me").p[1]);
    }
    const apex = JUMP_VEL ** 2 / (2 * GRAVITY);
    expect(maxY - restY).toBeGreaterThan(apex * 0.8);
    expect(maxY - restY).toBeLessThan(apex * 1.15);
    // and lands again
    const grounded = sim.getState("me").grounded;
    expect(grounded).toBe(true);
  });

  it("steps up a 0.2 m curb without jumping", async () => {
    const sim = await platformSim();
    // curb pad on top of the platform, 0.2 m proud, ahead of the character
    sim.addStaticBox({ x: 3, y: 0.1, z: 3 }, PX, PLATFORM_TOP + 0.1, PZ + 6);
    spawnOnPlatform(sim, "me");
    const restY = sim.getState("me").p[1];
    sim.setInput("me", makeInput({ moveZ: 1 }));
    for (let i = 0; i < 95; i++) sim.step(); // enough to climb, not to walk OFF the far side
    const s = sim.getState("me");
    expect(s.p[2]).toBeGreaterThan(PZ + 4); // actually made it onto the pad
    expect(s.p[1]).toBeGreaterThan(restY + 0.15);
  });

  it("an idle character does not drift", async () => {
    const sim = await platformSim();
    spawnOnPlatform(sim, "me");
    const before = sim.getState("me").p;
    for (let i = 0; i < 120; i++) sim.step();
    const after = sim.getState("me").p;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThan(0.001);
  });

  it("is deterministic: identical inputs produce identical trajectories", async () => {
    const run = async () => {
      const sim = await platformSim();
      spawnOnPlatform(sim, "me");
      const out: number[] = [];
      for (let i = 0; i < 300; i++) {
        sim.setInput(
          "me",
          makeInput({
            moveZ: i % 60 < 40 ? 1 : 0,
            moveX: i % 90 < 30 ? -1 : 0,
            yaw: Math.sin(i / 40),
            sprint: i % 120 < 60,
            jump: i % 75 === 0,
          }),
        );
        sim.step();
        const p = sim.getState("me").p;
        out.push(p[0], p[1], p[2]);
      }
      return out;
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });
});
