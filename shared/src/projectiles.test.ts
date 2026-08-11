import { describe, it, expect } from "vitest";
import { Sim } from "./sim";
import { stepDarts, stepNades, type Dart, type Nade } from "./projectiles";
import { CHAR_CENTER_Y } from "./character";
import { WEAPONS, DART_LIFE_TICKS, GRENADE } from "./weapons";

const PX = 500;
const PZ = 500;
const TOP = 50.5;

async function arena(): Promise<Sim> {
  const sim = await Sim.create();
  sim.addStaticBox({ x: 30, y: 0.5, z: 30 }, PX, 50, PZ);
  sim.step(); // raycasts only see colliders after a world step (query pipeline)
  return sim;
}

function place(sim: Sim, id: string, dx: number, dz: number): void {
  sim.addChar(id, 0, 0, 0);
  sim.setState(id, [PX + dx, TOP + CHAR_CENTER_Y, PZ + dz], [0, 0, 0, 1], [0, 0, 0]);
  for (let i = 0; i < 10; i++) sim.step();
}

function dartFrom(sim: Sim, owner: string, dir: [number, number, number], weapon = "blaster"): Dart {
  const p = sim.getState(owner).p;
  const speed = WEAPONS[weapon].dartSpeed;
  const len = Math.hypot(...dir);
  const start: [number, number, number] = [p[0], p[1] + 0.4, p[2]];
  return {
    id: "dart-1",
    owner,
    weapon,
    p: start,
    o: [...start],
    v: [(dir[0] / len) * speed, (dir[1] / len) * speed, (dir[2] / len) * speed],
    ticksLeft: DART_LIFE_TICKS,
  };
}

describe("darts", () => {
  it("hits a standing character 10 m ahead within the expected ticks", async () => {
    const sim = await arena();
    place(sim, "shooter", 0, 0);
    place(sim, "victim", 0, 10);
    const darts = [dartFrom(sim, "shooter", [0, 0, 1])];
    let hit: string | null = null;
    for (let i = 0; i < 30 && hit === null; i++) {
      sim.step();
      const ended = stepDarts(sim, darts, ["shooter", "victim"]);
      if (ended.length) hit = ended[0].hitChar;
    }
    expect(hit).toBe("victim");
  });

  it("misses a character 2 m off the aim axis and expires", async () => {
    const sim = await arena();
    place(sim, "shooter", 0, 0);
    place(sim, "victim", 2, 10);
    const darts = [dartFrom(sim, "shooter", [0, 0.3, 1])]; // slight upward so it clears the floor
    let sawEnd = false;
    for (let i = 0; i < DART_LIFE_TICKS + 5 && !sawEnd; i++) {
      const ended = stepDarts(sim, darts, ["shooter", "victim"]);
      if (ended.length) {
        sawEnd = true;
        expect(ended[0].hitChar).toBeNull();
      }
    }
    expect(sawEnd).toBe(true);
    expect(darts.length).toBe(0);
  });

  it("stops on static world geometry", async () => {
    const sim = await arena();
    place(sim, "shooter", 0, 0);
    const darts = [dartFrom(sim, "shooter", [0, -1, 0.2])]; // into the floor
    const ended: ReturnType<typeof stepDarts> = [];
    for (let i = 0; i < 10 && !ended.length; i++) ended.push(...stepDarts(sim, darts, ["shooter"]));
    expect(ended.length).toBe(1);
    expect(ended[0].hitWorld).toBe(true);
    expect(ended[0].hitChar).toBeNull();
  });

  it("never hits its owner", async () => {
    const sim = await arena();
    place(sim, "shooter", 0, 0);
    const d = dartFrom(sim, "shooter", [0, 0.5, 1]);
    d.p = sim.getState("shooter").p; // spawn dead-center inside the owner
    const darts = [d];
    const ended = stepDarts(sim, darts, ["shooter"]);
    expect(ended.filter((e) => e.hitChar === "shooter").length).toBe(0);
  });
});

describe("grenades", () => {
  it("bounces on the floor and explodes when the fuse runs out", async () => {
    const sim = await arena();
    const nades: Nade[] = [
      {
        id: "nade-1",
        owner: "x",
        p: [PX, TOP + 2, PZ],
        v: [3, 2, 0],
        fuse: GRENADE.fuseTicks,
      },
    ];
    let exploded: Nade[] = [];
    for (let i = 0; i < GRENADE.fuseTicks + 5 && !exploded.length; i++) {
      exploded = stepNades(sim, nades);
      // never tunnels through the platform
      if (nades.length) expect(nades[0].p[1]).toBeGreaterThan(TOP - 0.5);
    }
    expect(exploded.length).toBe(1);
    expect(nades.length).toBe(0);
    // ended up resting near the floor after bouncing
    expect(exploded[0].p[1]).toBeLessThan(TOP + 1.5);
  });
});
