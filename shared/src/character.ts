// On-foot character tuning. All gameplay numbers live here — never inline.

/** Capsule dimensions: total height = 2*(HALF_HEIGHT + RADIUS) = 1.9 m —
 * about two voxel blocks tall (still fits a 2-block tunnel). */
export const CHAR_RADIUS = 0.3;
export const CHAR_HALF_HEIGHT = 0.65;
/** Capsule center rest height above ground. */
export const CHAR_CENTER_Y = CHAR_HALF_HEIGHT + CHAR_RADIUS;
/** Eye height above the CAPSULE CENTER (camera pivot + dart muzzle). */
export const EYE_HEIGHT = 0.65;

export const WALK_SPEED = 5; // m/s
export const SPRINT_SPEED = 8; // m/s
/** Ground acceleration toward the target velocity (m/s²). */
export const ACCEL = 40;
/** Deceleration when no input (snappier stops than starts). */
export const DECEL = 50;
/** Fraction of ACCEL available while airborne. */
export const AIR_CONTROL = 0.3;

export const JUMP_VEL = 8; // m/s ⇒ apex ≈ 1.28 m at GRAVITY 25
export const GRAVITY = 25; // m/s² (stronger than earth: snappy arcade arcs)
export const TERMINAL_VY = 30; // m/s fall speed cap

/** Landing faster than this hurts (≈ a 3-block drop at GRAVITY 25). */
export const FALL_SAFE_SPEED = 12.5; // m/s
/** Fall damage per m/s of impact speed over FALL_SAFE_SPEED. */
export const FALL_DMG_PER_MS = 4;

/** Creative-style flight (grassland face, toggled by double-jump).
 * Movement follows the CAMERA (pitch included) so diving/climbing is smooth;
 * jump adds straight-up lift; sprint is a speed BOOST. */
export const FLY_SPEED = 14; // m/s cruise
export const FLY_BOOST = 24; // m/s while sprint is held
export const FLY_VERT = 8; // m/s straight-up lift while jump is held
export const FLY_ACCEL = 30; // m/s² vertical approach (smooth, no snapping)
/** Flight ceiling above the face's surface plane, meters. */
export const FLY_MAX_ALT = 26;
/** Double-jump detection window, in ticks. */
export const DOUBLE_JUMP_TICKS = 15;

/** Autostep: curbs/sidewalks up to this height don't stop you. */
export const STEP_OFFSET = 0.45;
/** Max walkable slope (radians). */
export const MAX_SLOPE = 0.9;
/** Snap-to-ground distance so downhill walking doesn't go airborne. */
export const SNAP_DIST = 0.3;
