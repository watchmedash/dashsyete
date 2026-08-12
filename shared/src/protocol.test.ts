import { describe, it, expect } from "vitest";
import { encode, decodeClient, decodeServer } from "./protocol";

describe("decodeClient", () => {
  it("round-trips a valid hello with a skin pick", () => {
    const msg = { t: "hello" as const, name: "Zed", skin: "character-d", key: "M4TR-88QK-ZV2N" };
    expect(decodeClient(encode(msg))).toEqual(msg);
  });

  it("defaults a missing key to empty string", () => {
    const decoded = decodeClient(JSON.stringify({ t: "hello", name: "Zed", skin: "character-a" }));
    expect(decoded && decoded.t === "hello" && decoded.key).toBe("");
  });
  it("returns null for garbage", () => {
    expect(decodeClient("{")).toBeNull();
    expect(decodeClient('{"t":"nope"}')).toBeNull();
    expect(decodeClient("42")).toBeNull();
  });
  it("clamps move axes to [-1,1] and coerces booleans", () => {
    const decoded = decodeClient(
      JSON.stringify({
        t: "input",
        input: { seq: 3, moveX: 99, moveZ: -42, yaw: 0.5, aimPitch: 0.2, jump: 1, sprint: 0, fire: "yes" },
      }),
    );
    expect(decoded).toEqual({
      t: "input",
      input: { seq: 3, moveX: 1, moveZ: -1, yaw: 0.5, aimPitch: 0.2, jump: true, sprint: false, fire: true, nade: false, swap: false },
    });
  });
  it("wraps yaw to ±π and clamps aimPitch to ±1.55", () => {
    const decoded = decodeClient(
      JSON.stringify({
        t: "input",
        input: { seq: 1, moveX: 0, moveZ: 0, yaw: Math.PI * 3, aimPitch: -9, jump: false, sprint: false, fire: false },
      }),
    );
    expect(decoded?.t).toBe("input");
    if (decoded?.t !== "input") return;
    expect(decoded.input.yaw).toBeCloseTo(Math.PI, 5);
    expect(decoded.input.aimPitch).toBe(-1.55);
  });
  it("still accepts unstuck", () => {
    expect(decodeClient(encode({ t: "unstuck" }))).toEqual({ t: "unstuck" });
  });
  it("truncates long names to 16 chars and defaults empty to Player", () => {
    const long = decodeClient(JSON.stringify({ t: "hello", name: "a".repeat(40), skin: "character-a" }));
    expect(long && long.t === "hello" && long.name.length).toBe(16);
    const empty = decodeClient(JSON.stringify({ t: "hello", name: "   ", skin: "character-a" }));
    expect(empty && empty.t === "hello" && empty.name).toBe("Player");
  });
});

describe("decodeServer", () => {
  it("round-trips a snapshot with chars and darts", () => {
    const msg = {
      t: "snapshot" as const,
      time: 1.5,
      lastSeq: 7,
      chars: [
        {
          id: "x",
          p: [1, 2, 3] as [number, number, number],
          q: [0, 0, 0, 1] as [number, number, number, number],
          v: [0, 0, 0] as [number, number, number],
          hp: 100,
          weapon: "blaster",
          grounded: true,
        },
      ],
      darts: [
        {
          id: "dart-1",
          p: [0, 1, 0] as [number, number, number],
          v: [0, 0, 45] as [number, number, number],
          owner: "x",
        },
      ],
    };
    expect(decodeServer(encode(msg))).toEqual(msg);
  });
  it("returns null for garbage", () => {
    expect(decodeServer("{")).toBeNull();
    expect(decodeServer('{"t":"nope"}')).toBeNull();
  });

  it("accepts reject messages", () => {
    expect(decodeServer(encode({ t: "reject", reason: "wrong password" }))).toEqual({
      t: "reject",
      reason: "wrong password",
    });
  });
});
