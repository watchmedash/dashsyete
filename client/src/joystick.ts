const DEADZONE = 0.15;

/**
 * Left-stick movement mapping: push where you want to RUN on screen; the sim
 * rotates the move vector by the camera yaw. jx/jy are stick deflection in
 * -1..1 with +jy = pulled DOWN (toward the player).
 *
 * Screen-up = camera-forward ⇒ moveZ = -jy. Looking along the camera
 * direction, world +x appears to the LEFT, so screen-right = -x ⇒
 * moveX = -jx (matches the D key strafing right).
 */
export function stickToMove(jx: number, jy: number): { moveX: number; moveZ: number } {
  const magnitude = Math.hypot(jx, jy);
  if (magnitude < DEADZONE) return { moveX: 0, moveZ: 0 };
  const clamp = magnitude > 1 ? 1 / magnitude : 1;
  return { moveX: -jx * clamp, moveZ: -jy * clamp };
}
