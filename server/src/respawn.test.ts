import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildCityMap } from "../../shared/src/cityMap";
import { basis } from "../../shared/src/gravity";
import { Game } from "./game";

let game: Game;
beforeAll(async () => {
  game = await Game.start(0); // ephemeral port — boots the DEFAULT (sky) map
});
afterAll(() => game.stop());

const map = buildCityMap();
// Sky mode: walkable = a solid block directly under the point.
const onGround = (p: { x: number; z: number; y?: number }) =>
  game.sim.vox!.solid(Math.floor(p.x), Math.round(p.y ?? 0) - 1, Math.floor(p.z));

describe("sky map boot", () => {
  it("runs the voxel sky world by default", () => {
    expect(game.sim.vox).not.toBeNull();
    expect(map.vox).toBeDefined();
    expect(map.spawns.length).toBeGreaterThanOrEqual(12);
  });
});

describe("void hazard respawn", () => {
  it("nearestRoadRespawn has no roads in the sky — falls back to a spawn point", () => {
    expect(game.nearestRoadRespawn(140, 20, "nobody")).toBeNull();
    const s = game.nextSpawn();
    expect(onGround(s)).toBe(true);
  });
});

describe("nextSpawn", () => {
  it("returns an island spawn with solid ground and headroom", () => {
    const s = game.nextSpawn();
    expect(onGround(s)).toBe(true);
    expect(game.sim.vox!.solid(Math.floor(s.x), Math.round(s.y ?? 0), Math.floor(s.z))).toBe(false);
  });
});

describe("pickups end-to-end", () => {
  const goTo = (id: string, crate: { x: number; z: number; y?: number }) =>
    game.sim.teleport(id, crate.x, crate.z, 0, crate.y ?? 0);

  it("a gun crate fills slot 2 with a full mag and equips it", async () => {
    const p = game.addPlayer({ name: "Grabber", skin: "character-a" });
    const crate = map.crateSpawns.find((c) => c.weapon === "heavy")!;
    goTo(p.id, crate);
    // let a few server ticks run (60 Hz interval is live in Game.start)
    await new Promise((r) => setTimeout(r, 150));
    const got = game.roster.get(p.id)!;
    expect(got.slots[1]).toBe("heavy");
    expect(got.activeSlot).toBe(1);
    expect(got.ammo[1]).toBeGreaterThan(0);
    expect(got.slots[0]).toBe("blaster"); // the starter never leaves
    game.removePlayer(p.id);
  });

  it("grenade crates grant grenades instead of a gun", async () => {
    const p = game.addPlayer({ name: "Bomber", skin: "character-a" });
    const crate = map.crateSpawns.find((c) => c.weapon === "grenade")!;
    goTo(p.id, crate);
    await new Promise((r) => setTimeout(r, 150));
    const got = game.roster.get(p.id)!;
    expect(got.grenades).toBeGreaterThan(0);
    expect(got.slots[1]).toBeNull();
    game.removePlayer(p.id);
  });

  it("first-aid kits heal the hurt (and are skipped at full HP)", async () => {
    const p = game.addPlayer({ name: "Patient", skin: "character-a" });
    p.hp = 30;
    const crate = map.crateSpawns.find((c) => c.weapon === "health")!;
    goTo(p.id, crate);
    await new Promise((r) => setTimeout(r, 150));
    // +50 from the kit (a sliver of natural regen may also tick in)
    const hp = game.roster.get(p.id)!.hp;
    expect(hp).toBeGreaterThanOrEqual(80);
    expect(hp).toBeLessThan(85);
    game.removePlayer(p.id);
  });

  it("ammo cells refill the slot-2 gun", async () => {
    const p = game.addPlayer({ name: "Reloader", skin: "character-a" });
    p.slots[1] = "rapid";
    p.ammo[1] = 3;
    const crate = map.crateSpawns.find((c) => c.weapon === "ammo")!;
    goTo(p.id, crate);
    await new Promise((r) => setTimeout(r, 150));
    expect(game.roster.get(p.id)!.ammo[1]).toBe(60);
    game.removePlayer(p.id);
  });
});

describe("block edits (server-authoritative)", () => {
  it("breaking earns a block, placing spends it, world + broadcast update", async () => {
    const p = game.addPlayer({ name: "Miner", skin: "character-a" });
    const s = game.nextSpawn();
    game.sim.teleport(p.id, s.x, s.z, 0, s.y ?? 0);
    await new Promise((r) => setTimeout(r, 60)); // settle a few live ticks
    // a ground block one cell to the SIDE of the character (in reach, but
    // not overlapping the capsule so it can be placed back)
    const up = game.sim.getUp(p.id);
    const cp = game.sim.getState(p.id).p;
    const { t1, t2 } = basis(up);
    let bx = 0, by = 0, bz = 0, found = false;
    for (const t of [t1, [-t1[0], -t1[1], -t1[2]], t2, [-t2[0], -t2[1], -t2[2]]] as const) {
      bx = Math.floor(cp[0] - up[0] * 1.0 + t[0] * 1.2);
      by = Math.floor(cp[1] - up[1] * 1.0 + t[1] * 1.2);
      bz = Math.floor(cp[2] - up[2] * 1.0 + t[2] * 1.2);
      if (game.sim.vox!.solid(bx, by, bz)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    const before = p.blocks;
    game["handleBlockEdit"](p.id, { x: bx, y: by, z: bz, b: 0 });
    expect(game.sim.vox!.get(bx, by, bz)).toBe(0);
    expect(p.blocks).toBe(before + 1);
    // place it back
    game["handleBlockEdit"](p.id, { x: bx, y: by, z: bz, b: 6 });
    expect(game.sim.vox!.get(bx, by, bz)).toBe(6);
    expect(p.blocks).toBe(before);
    // out of reach is rejected
    game["handleBlockEdit"](p.id, { x: bx + 40, y: by, z: bz, b: 0 });
    expect(p.blocks).toBe(before);
    game.removePlayer(p.id);
  });
});

describe("tick pacing", () => {
  it("game time tracks wall time (no slow-motion drift)", async () => {
    // Regression: a bare setInterval(16.67ms) fires late under load and the
    // whole game dilates into slow motion. The drift-compensated pump must
    // keep game time within 10% of wall time over a real 1.5 s window.
    const t0 = game.now();
    const w0 = performance.now();
    await new Promise((r) => setTimeout(r, 1500));
    const gameElapsed = game.now() - t0;
    const wallElapsed = (performance.now() - w0) / 1000;
    expect(gameElapsed).toBeGreaterThan(wallElapsed * 0.9);
    expect(gameElapsed).toBeLessThan(wallElapsed * 1.1);
  });
});
