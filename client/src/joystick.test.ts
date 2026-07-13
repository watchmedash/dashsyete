import { describe, it, expect } from "vitest";
import { autoDrift, joystickToInput } from "./joystick";
import { AUTO_DRIFT_MIN_SPEED, AUTO_DRIFT_MIN_STEER } from "../../shared/src/constants";

describe("joystickToInput", () => {
  it("deadzone: tiny deflections do nothing", () => {
    expect(joystickToInput(0.05, -0.05, 0, 0)).toEqual({ steer: 0, throttle: 0 });
  });

  it("push up (away from camera) with camera behind the car = straight, full throttle", () => {
    const { steer, throttle } = joystickToInput(0, -1, 0, 0);
    expect(Math.abs(steer)).toBeLessThan(0.05);
    expect(throttle).toBeCloseTo(1);
  });

  it("push screen-right steers the car toward the camera's right", () => {
    // camera behind car (yaw 0). Screen-right = -x world (looking along +z, +x is left),
    // reaching -x needs a yaw DECREASE => negative steer.
    const { steer } = joystickToInput(1, 0, 0, 0);
    expect(steer).toBeLessThan(0);
  });

  it("pull down (toward player) = reverse", () => {
    const { throttle } = joystickToInput(0, 1, 0, 0);
    expect(throttle).toBeLessThan(0);
  });

  it("is camera-relative: same push, rotated camera, different world steer", () => {
    const ahead = joystickToInput(0, -1, 0, 0);          // camera aligned with car
    const rotated = joystickToInput(0, -1, Math.PI / 2, 0); // camera turned 90°
    expect(Math.abs(ahead.steer)).toBeLessThan(0.05);
    expect(Math.abs(rotated.steer)).toBeGreaterThan(0.5);
  });
});

describe("autoDrift", () => {
  it("engages only when fast, steering hard, and on throttle", () => {
    expect(autoDrift(AUTO_DRIFT_MIN_SPEED + 2, AUTO_DRIFT_MIN_STEER + 0.1, 1)).toBe(true);
    expect(autoDrift(AUTO_DRIFT_MIN_SPEED - 2, 1, 1)).toBe(false);       // too slow
    expect(autoDrift(AUTO_DRIFT_MIN_SPEED + 2, 0.2, 1)).toBe(false);     // gentle steer
    expect(autoDrift(AUTO_DRIFT_MIN_SPEED + 2, 1, 0)).toBe(false);       // off throttle
  });
});
