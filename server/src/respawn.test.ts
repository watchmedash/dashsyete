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
  it("puts a car that sank off the east island back on that island's shore road", () => {
    const s = game.nearestRoadRespawn(290, 20, "nobody")!;
    expect(s).not.toBeNull();
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 290, s.z - 20)).toBeLessThan(80); // nearby, not home plaza
  });

  it("puts a car that fell off a spoke bridge back onto the bridge deck", () => {
    // north spoke bridge runs near x=6, z in [-132..-96]
    const s = game.nearestRoadRespawn(6, -114, "nobody")!;
    expect(onGround(s)).toBe(true);
    expect(Math.hypot(s.x - 6, s.z + 114)).toBeLessThan(20);
  });

  it("faces the respawned car along the road, not into the void", () => {
    const s = game.nearestRoadRespawn(290, 20, "nobody")!;
    // the aim heading must point at ANOTHER road tile ~a tile away
    const ahead = { x: s.x + Math.sin(s.rotY) * 12, z: s.z + Math.cos(s.rotY) * 12 };
    expect(onGround(ahead)).toBe(true);
  });
});
