import { describe, it, expect } from "vitest";
import { stickToMove } from "./joystick";

describe("stickToMove", () => {
  it("dead-zones tiny deflections", () => {
    expect(stickToMove(0.05, -0.05)).toEqual({ moveX: 0, moveZ: 0 });
  });

  it("stick up runs forward (camera-relative +z)", () => {
    const m = stickToMove(0, -1);
    expect(m.moveZ).toBeCloseTo(1);
    expect(m.moveX).toBeCloseTo(0);
  });

  it("stick right strafes screen-right (world -x looking along +forward)", () => {
    const m = stickToMove(1, 0);
    expect(m.moveX).toBeCloseTo(-1);
    expect(m.moveZ).toBeCloseTo(0);
  });

  it("clamps diagonal magnitude to 1", () => {
    const m = stickToMove(1, 1);
    expect(Math.hypot(m.moveX, m.moveZ)).toBeLessThanOrEqual(1.0001);
  });

  it("passes through partial deflection analog", () => {
    const m = stickToMove(0, -0.5);
    expect(m.moveZ).toBeCloseTo(0.5);
  });
});
