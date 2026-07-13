import { describe, it, expect } from "vitest";
import { encode, decodeClient, decodeServer } from "./protocol";

describe("decodeClient", () => {
  it("round-trips a valid hello", () => {
    const msg = { t: "hello" as const, name: "Zed", car: "sedan-sports", pass: "hunter2" };
    expect(decodeClient(encode(msg))).toEqual(msg);
  });

  it("defaults a missing pass to empty string", () => {
    const decoded = decodeClient(JSON.stringify({ t: "hello", name: "Zed", car: "suv" }));
    expect(decoded && decoded.t === "hello" && decoded.pass).toBe("");
  });
  it("returns null for garbage", () => {
    expect(decodeClient("{")).toBeNull();
    expect(decodeClient('{"t":"nope"}')).toBeNull();
    expect(decodeClient("42")).toBeNull();
  });
  it("clamps input fields to [-1,1]", () => {
    const decoded = decodeClient(
      JSON.stringify({ t: "input", input: { seq: 3, throttle: 99, steer: -42, brake: 0.5, handbrake: 1 } }),
    );
    expect(decoded).toEqual({
      t: "input",
      input: { seq: 3, throttle: 1, steer: -1, brake: 0.5, handbrake: true },
    });
  });
  it("truncates long names to 16 chars and defaults empty to Player", () => {
    const long = decodeClient(JSON.stringify({ t: "hello", name: "a".repeat(40), car: "suv" }));
    expect(long && long.t === "hello" && long.name.length).toBe(16);
    const empty = decodeClient(JSON.stringify({ t: "hello", name: "   ", car: "suv" }));
    expect(empty && empty.t === "hello" && empty.name).toBe("Player");
  });
});

describe("decodeServer", () => {
  it("round-trips a snapshot", () => {
    const msg = {
      t: "snapshot" as const,
      time: 1.5,
      lastSeq: 7,
      cars: [{ id: "x", p: [1, 2, 3] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, 0] as [number, number, number], hp: 100 }],
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
