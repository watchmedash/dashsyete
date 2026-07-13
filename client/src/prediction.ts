import { Sim } from "../../shared/src/sim";
import type { InputState } from "../../shared/src/protocol";

const SNAP_DISTANCE = 4; // metres of error before hard-snapping to server state
const BLEND = 0.15;      // soft correction strength per snapshot
// Rotation is only corrected past this error (rad). The rapier vehicle
// controller has an inherent ±1°/tick yaw dither; blending toward the
// server's out-of-phase dither every snapshot reads as constant swaying.
const ROT_DEADZONE = 0.15;

/**
 * Local-car prediction: a private Rapier world with the static city and only
 * our own car, stepped immediately from local inputs so controls feel instant.
 * Server snapshots pull it back in line (softly, or a hard snap when far off).
 */
export class LocalPrediction {
  private sim: Sim;
  private spawned = false;

  private constructor(sim: Sim) {
    this.sim = sim;
  }

  static async create(): Promise<LocalPrediction> {
    return new LocalPrediction(await Sim.create());
  }

  /** One fixed 60 Hz tick with the current input. */
  step(input: InputState): void {
    if (!this.spawned) return;
    this.sim.setInput("me", input);
    this.sim.step();
  }

  getTransform(): { p: [number, number, number]; q: [number, number, number, number] } | null {
    if (!this.spawned) return null;
    const { p, q } = this.sim.getState("me");
    return { p, q };
  }

  getVelocity(): [number, number, number] {
    if (!this.spawned) return [0, 0, 0];
    return this.sim.getState("me").v;
  }

  /** Reconcile with the authoritative state from a server snapshot. */
  correct(p: [number, number, number], q: [number, number, number, number], v: [number, number, number]): void {
    if (!this.spawned) {
      this.sim.addCar("me", p[0], p[2], 0);
      this.sim.setState("me", p, q, v);
      this.spawned = true;
      return;
    }
    const cur = this.sim.getState("me");
    const err = Math.hypot(cur.p[0] - p[0], cur.p[1] - p[1], cur.p[2] - p[2]);
    if (err > SNAP_DISTANCE) {
      this.sim.setState("me", p, q, v);
      return;
    }
    // rotation error as quaternion angle: 2*acos(|dot|)
    const dot = Math.abs(cur.q[0] * q[0] + cur.q[1] * q[1] + cur.q[2] * q[2] + cur.q[3] * q[3]);
    const rotErr = 2 * Math.acos(Math.min(1, dot));
    const qTarget = rotErr < ROT_DEADZONE ? cur.q : q;
    this.sim.blendState("me", p, qTarget, v, BLEND);
  }

  /** Forget the car (e.g. after a knockout) so the next snapshot respawns it. */
  reset(): void {
    if (this.spawned) this.sim.removeCar("me");
    this.spawned = false;
  }
}

