// Vehicle physics tuning. All values are "tune by playtest" — adjust freely.

export const CHASSIS_HALF = { x: 1.0, y: 0.45, z: 2.1 };
export const CHASSIS_MASS = 900;

export const WHEEL_RADIUS = 0.45;
export const WHEEL_REST = 0.5;        // suspension rest length
export const SUSPENSION_STIFFNESS = 28;
export const ENGINE_FORCE = 4200;
export const MAX_SPEED = 28;          // m/s; engine cuts out above this
export const REVERSE_FORCE = 2500;
export const BRAKE_FORCE = 18;
export const HANDBRAKE_FORCE = 40;
export const MAX_STEER = 0.55;        // radians
export const SIDE_FRICTION = 4;       // wheel side grip; default 1 slides like ice
export const STEER_SPEED_FALLOFF = 10; // m/s at which steering lock is roughly halved
export const BALLAST_DROP = 0.4;       // ballast slab hangs this far below the chassis floor

// Wheel attachment points in chassis-local space [x, y, z].
// Front pair first (steering), then rear pair (drive).
export const WHEEL_POSITIONS: [number, number, number][] = [
  [-1.0, -0.3, 1.45],
  [1.0, -0.3, 1.45],
  [-1.0, -0.3, -1.45],
  [1.0, -0.3, -1.45],
];
