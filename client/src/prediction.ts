import { Sim } from "../../shared/src/sim";
import type { InputState } from "../../shared/src/protocol";

// If the server falls this many inputs behind (bad connection), skip the
// replay and just adopt its state — replaying hundreds of steps stalls a frame.
const MAX_REPLAY = 30;

/**
 * Local-car prediction with REWIND + REPLAY reconciliation: a private Rapier
 * world with the static city and only our own car, stepped immediately from
 * local inputs so controls feel instant.
 *
 * Every snapshot carries the last input seq the server had applied. We reset
 * the car to the server's authoritative state and re-apply every input the
 * server hasn't seen yet. Because both worlds run identical deterministic
 * code, the replayed pose lands where the server WILL be once those inputs
 * arrive — corrections become invisible instead of the old soft-blend, which
 * yanked the car backwards ~15% of the latency gap 20 times a second (the
 * "push and pull" while driving).
 */
export class LocalPrediction {
  private sim: Sim;
  private spawned = false;
  private pending: InputState[] = [];

  private constructor(sim: Sim) {
    this.sim = sim;
  }

  static async create(): Promise<LocalPrediction> {
    return new LocalPrediction(await Sim.create());
  }

  /** One fixed 60 Hz tick with the current input. */
  step(input: InputState): void {
    if (!this.spawned) return;
    this.pending.push({ ...input });
    if (this.pending.length > MAX_REPLAY * 4) this.pending.splice(0, this.pending.length - MAX_REPLAY * 4);
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
  correct(
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
    lastSeq: number,
  ): void {
    if (!this.spawned) {
      this.sim.addCar("me", p[0], p[2], 0);
      this.sim.setState("me", p, q, v);
      this.spawned = true;
      return;
    }
    // drop everything the server has already applied
    while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
    this.sim.setState("me", p, q, v);
    if (this.pending.length > MAX_REPLAY) {
      this.pending.length = 0;
      return;
    }
    for (const input of this.pending) {
      this.sim.setInput("me", input);
      this.sim.step();
    }
  }

  /** Forget the car (e.g. after a knockout) so the next snapshot respawns it. */
  reset(): void {
    if (this.spawned) this.sim.removeCar("me");
    this.spawned = false;
    this.pending = [];
  }
}
