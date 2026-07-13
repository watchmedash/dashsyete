import { AUTO_DRIFT_MIN_SPEED, AUTO_DRIFT_MIN_STEER } from "../../shared/src/constants";

const DEADZONE = 0.15;

/**
 * Camera-relative joystick driving: push where you want the car to GO on
 * screen; the car steers itself toward that world heading (same convention
 * as the bot steering — positive steer increases yaw, and pulling the stick
 * near-opposite the car's heading reverses).
 *
 * jx/jy are the stick deflection in -1..1 with +jy = pulled DOWN (toward the
 * player). Screen-up means "away from the camera" = the camera's yaw.
 */
export function joystickToInput(
  jx: number,
  jy: number,
  cameraYaw: number,
  carHeading: number,
): { steer: number; throttle: number } {
  const magnitude = Math.min(1, Math.hypot(jx, jy));
  if (magnitude < DEADZONE) return { steer: 0, throttle: 0 };

  // Screen axes -> world heading. Screen-up = cameraYaw. Looking along the
  // camera direction, world +x appears to the LEFT, so screen-right = a yaw
  // DECREASE: subtract the stick's clockwise screen angle.
  const desired = cameraYaw - Math.atan2(jx, -jy);
  let angle = desired - carHeading;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  if (Math.abs(angle) > 2.4) {
    // Target is behind the car: back toward it (nose swings opposite steer).
    return { steer: -Math.sign(angle), throttle: -0.8 * magnitude };
  }
  return { steer: Math.max(-1, Math.min(1, angle * 1.5)), throttle: magnitude };
}

/** Automatic handbrake: fast + steering hard + on throttle = drift. */
export function autoDrift(speed: number, steer: number, throttle: number): boolean {
  return speed > AUTO_DRIFT_MIN_SPEED && Math.abs(steer) > AUTO_DRIFT_MIN_STEER && throttle > 0.5;
}
