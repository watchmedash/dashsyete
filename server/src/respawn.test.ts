import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildCityMap } from "../../shared/src/cityMap";
import { Game } from "./game";

let game: Game;
beforeAll(async () => {
  game = await Game.start(0); // ephemeral port
});
afterAll(() => game.stop());

const map = buildCityMap();
const onGround = (p: { x: number; z: number }) =>
  map.grounds.some((g) => p.x >= g.x0 && p.x <= g.x1 && p.z >= g.z0 && p.z <= g.z1);

describe("nearestRoadRespawn", () => {
  it("puts a character who fell off the east shore back on a nearby street", () => {
    const s = game.nearestRoadRespawn(140, 20, "nobody")!;
    expect(s).not.toBeNull();
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 140, s.z - 20)).toBeLessThan(80);
  });

  it("puts a character who fell off the north rim back near the north edge", () => {
    const s = game.nearestRoadRespawn(0, -140, "nobody")!;
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 0, s.z + 140)).toBeLessThan(80);
  });
});

describe("nextSpawn", () => {
  it("returns a spawn on walkable ground", () => {
    const s = game.nextSpawn();
    expect(onGround(s)).toBe(true);
  });
});

describe("pickups end-to-end", () => {
  it("a gun crate fills slot 2 with a full mag and equips it", async () => {
    const p = game.addPlayer({ name: "Grabber", skin: "character-a" });
    const crate = map.crateSpawns.find((c) => c.weapon === "heavy")!;
    game.sim.teleport(p.id, crate.x, crate.z, 0);
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
    game.sim.teleport(p.id, crate.x, crate.z, 0);
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
    game.sim.teleport(p.id, crate.x, crate.z, 0);
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
    game.sim.teleport(p.id, crate.x, crate.z, 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(game.roster.get(p.id)!.ammo[1]).toBe(60);
    game.removePlayer(p.id);
  });
});
