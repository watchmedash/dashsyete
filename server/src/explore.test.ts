import { describe, it, expect, afterAll } from "vitest";
import { Game } from "./game";
import { faceUp } from "../../shared/src/gravity";
import { encode, decodeServer, type ServerMsg } from "../../shared/src/protocol";

/**
 * EXPLORE mode (2026-08-15 pivot): peaceful solo planet exploration.
 * Drives a real Game through a faked socket — the exact soloWorker path.
 */
class FakeWs {
  readyState = 1;
  out: ServerMsg[] = [];
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  on(ev: string, cb: (...args: unknown[]) => void): void {
    const list = this.handlers.get(ev) ?? [];
    list.push(cb);
    this.handlers.set(ev, list);
  }
  deliver(ev: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(ev) ?? []) cb(...args);
  }
  send(data: string): void {
    const m = decodeServer(String(data));
    if (m) this.out.push(m);
  }
  close(): void {}
}

const games: Game[] = [];
afterAll(() => {
  for (const g of games) g.stop();
});

async function bootExplore(restore?: { vox: string; p: [number, number, number]; inv: [number, number][] }) {
  const game = await Game.create({ explore: true, slots: 1 });
  games.push(game);
  const ws = new FakeWs();
  game.onConnection(ws as never);
  ws.deliver(
    "message",
    encode({ t: "hello", name: "Explorer", skin: "character-a", key: "", restore }),
  );
  const welcome = ws.out.find((m) => m.t === "welcome") as Extract<ServerMsg, { t: "welcome" }>;
  const player = game.roster.get(welcome.id)!;
  return { game, ws, player };
}

/** First solid, breakable cell under the player's feet. */
function groundCell(game: Game, pos: [number, number, number]): [number, number, number, number] {
  const up = faceUp(pos, null, true);
  for (let d = 1; d < 6; d++) {
    const x = Math.floor(pos[0] - up[0] * d);
    const y = Math.floor(pos[1] - up[1] * d);
    const z = Math.floor(pos[2] - up[2] * d);
    const b = game.sim.vox!.get(x, y, z);
    if (b !== 0 && b !== 10 && b !== 11 && b !== 13) return [x, y, z, b];
  }
  throw new Error("no breakable ground under spawn");
}

describe("EXPLORE mode", () => {
  it("has no bots, no crates, and ignores fire inputs", async () => {
    const { game, ws } = await bootExplore();
    expect(game.roster.all().length).toBe(1); // just the explorer
    ws.deliver(
      "message",
      encode({
        t: "input",
        input: {
          seq: 1, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0,
          jump: false, sprint: false, fire: true, nade: true, swap: false, sel: 1,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 120)); // let a few ticks run
    const snap = ws.out.filter((m) => m.t === "snapshot").at(-1) as Extract<ServerMsg, { t: "snapshot" }>;
    expect(snap.darts.length).toBe(0); // fire+nade did nothing
    expect(snap.chars.some((c) => c.id.startsWith("crate-"))).toBe(false);
  });

  it("mined blocks keep their ORIGINAL form in the 8-slot inventory and place back as themselves", async () => {
    const { game, ws, player } = await bootExplore();
    const pos = game.sim.getState(player.id).p;
    const [x, y, z, type] = groundCell(game, pos);
    ws.deliver("message", encode({ t: "blockEdit", x, y, z, b: 0 }));
    expect(game.sim.vox!.get(x, y, z)).toBe(0); // broken
    expect(player.inv).toEqual([[type, 1]]); // kept as its own type
    expect(player.blocks).toBe(30); // battle stock untouched

    // place it back — same spot is now free of the occupant check? No: we
    // stand ON it, so pick a spot above the head instead
    const up = faceUp(pos, null, true);
    const px = Math.floor(pos[0] + up[0] * 2.6);
    const py = Math.floor(pos[1] + up[1] * 2.6);
    const pz = Math.floor(pos[2] + up[2] * 2.6);
    ws.deliver("message", encode({ t: "blockEdit", x: px, y: py, z: pz, b: type }));
    expect(game.sim.vox!.get(px, py, pz)).toBe(type); // original form restored
    expect(player.inv).toEqual([]); // stack emptied → slot removed
  });

  it("cannot place a block type it does not have", async () => {
    const { game, ws, player } = await bootExplore();
    const pos = game.sim.getState(player.id).p;
    const up = faceUp(pos, null, true);
    const px = Math.floor(pos[0] + up[0] * 2.6);
    const py = Math.floor(pos[1] + up[1] * 2.6);
    const pz = Math.floor(pos[2] + up[2] * 2.6);
    ws.deliver("message", encode({ t: "blockEdit", x: px, y: py, z: pz, b: 3 }));
    expect(game.sim.vox!.get(px, py, pz)).toBe(0); // rejected — no stone owned
    expect(player.inv).toEqual([]);
  });

  it("restores a saved world, position and inventory on hello", async () => {
    // first session: break a block, remember everything
    const first = await bootExplore();
    const pos = first.game.sim.getState(first.player.id).p;
    const [x, y, z, type] = groundCell(first.game, pos);
    first.ws.deliver("message", encode({ t: "blockEdit", x, y, z, b: 0 }));
    const save = {
      vox: first.game.sim.vox!.serialize(),
      p: [pos[0], pos[1], pos[2]] as [number, number, number],
      inv: first.player.inv!.map(([a, b]) => [a, b] as [number, number]),
    };

    // second session restores it
    const second = await bootExplore(save);
    expect(second.game.sim.vox!.get(x, y, z)).toBe(0); // the hole survived
    expect(second.player.inv).toEqual([[type, 1]]); // stack survived
    const p2 = second.game.sim.getState(second.player.id).p;
    expect(Math.hypot(p2[0] - pos[0], p2[1] - pos[1], p2[2] - pos[2])).toBeLessThan(2);
  });
});
