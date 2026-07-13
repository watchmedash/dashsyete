// Vehicle physics tuning. All values are "tune by playtest" - adjust freely.

export const CHASSIS_HALF = { x: 1.0, y: 0.45, z: 2.1 };
export const CHASSIS_MASS = 900;

export const WHEEL_RADIUS = 0.45;
export const WHEEL_REST = 0.5;        // suspension rest length
export const SUSPENSION_STIFFNESS = 16;
// Without explicit damping the suspension limit-cycles at 60 Hz (sustained
// ~1-2 cm bounce = the visible car shake/sway). These settle it dead.
export const SUSPENSION_COMPRESSION = 2.0;
export const SUSPENSION_RELAXATION = 2.5;
export const ENGINE_FORCE = 5200;
export const MAX_SPEED = 28;          // m/s; engine cuts out above this
export const REVERSE_FORCE = 2500;
export const BRAKE_FORCE = 18;
export const IDLE_BRAKE = 8;          // parking/engine brake with no throttle: a raycast
                                      // vehicle has ZERO longitudinal friction when free-
                                      // rolling, so idle cars "walk" (side-friction impulses
                                      // feed a slow yaw+creep instability at rest)
export const HANDBRAKE_FORCE = 40;
export const MAX_STEER = 0.55;        // radians
export const SIDE_FRICTION = 1.5;     // wheel side grip. CRITICAL: at >= 1.75 the side-
                                      // friction solver overshoots each tick and the whole
                                      // car buzzes with a +-2.5 deg/tick yaw seesaw (feels
                                      // uncontrollable) and hard turns scrub ALL speed.
                                      // At 1.5: clean traces, turns keep speed. Measured
                                      // with scripts/probe-steer.mts - rerun if you touch
                                      // this, ANGULAR_DAMPING, or the ballast size.
export const STEER_SPEED_FALLOFF = 16; // m/s at which steering lock is roughly halved
export const BALLAST_DROP = 0.15;      // ballast slab below the chassis floor. Keep modest:
                                       // a deep slab grinds the road under cornering roll
                                       // (jitter + trip-flips on any touch)
export const ANGULAR_DAMPING = 1.6;    // kills post-steer fishtailing and flip energy
export const MAX_POP_VY = 3;           // hard cap on upward velocity (m/s): no contact
                                       // geometry may launch a car (wedge/lever effects
                                       // under a broadside are chaotic and unbounded)
export const MAX_TUMBLE = 1.7;         // hard cap on roll/pitch rate (rad/s): impacts
                                       // may rock a car but never barrel-roll it
export const STEER_RATE = 8;           // full-lock per second: smooths binary keyboard steering
export const CHASSIS_REST_Y = 1.02;    // MEASURED rest ride height (suspension compressed,
                                       // 16 m/s^2 gravity, idle-sleep freeze); the visual car
                                       // model is anchored to this

// Wheel attachment points in chassis-local space [x, y, z].
// Front pair first (steering), then rear pair (drive).
export const WHEEL_POSITIONS: [number, number, number][] = [
  [-1.0, -0.3, 1.45],
  [1.0, -0.3, 1.45],
  [-1.0, -0.3, -1.45],
  [1.0, -0.3, -1.45],
];
