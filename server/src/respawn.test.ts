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
  it("puts a character who fell off the east shore back on a nearby road", () => {
    const s = game.nearestRoadRespawn(170, 20, "nobody")!;
    expect(s).not.toBeNull();
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 170, s.z - 20)).toBeLessThan(80);
  });

  it("puts a character who fell off the harbor dock back near the dock", () => {
    const s = game.nearestRoadRespawn(0, -180, "nobody")!;
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 0, s.z + 180)).toBeLessThan(80);
  });
});

describe("nextSpawn", () => {
  it("returns a spawn on walkable ground", () => {
    const s = game.nextSpawn();
    expect(onGround(s)).toBe(true);
  });
});

describe("weapon pickups end-to-end", () => {
  it("swaps the weapon when a player stands on an armed crate", async () => {
    const p = game.addPlayer({ name: "Grabber", skin: "character-a" });
    const crate = map.crateSpawns.find((c) => c.weapon === "heavy")!;
    game.sim.teleport(p.id, crate.x, crate.z, 0);
    // let a few server ticks run (60 Hz interval is live in Game.start)
    await new Promise((r) => setTimeout(r, 150));
    expect(game.roster.get(p.id)?.weapon).toBe("heavy");
    game.removePlayer(p.id);
  });

  it("grenade crates grant grenades instead of swapping", async () => {
    const p = game.addPlayer({ name: "Bomber", skin: "character-a" });
    const crate = map.crateSpawns.find((c) => c.weapon === "grenade")!;
    game.sim.teleport(p.id, crate.x, crate.z, 0);
    await new Promise((r) => setTimeout(r, 150));
    const got = game.roster.get(p.id)!;
    expect(got.grenades).toBeGreaterThan(0);
    expect(got.weapon).toBe("blaster");
    game.removePlayer(p.id);
  });
});
