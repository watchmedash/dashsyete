import type { CarSnap } from "../../shared/src/protocol";
import type { Sim } from "../../shared/src/sim";

const SPEED = 8; // m/s along the rail loop

/**
 * Decorative perimeter train: a kinematic collider driven along the rail
 * loop. Blocks cars physically but deals no damage (impact events only fire
 * for car-vs-car collider pairs).
 */
export class Train {
  private sim: Sim;
  private path: { x: number; z: number }[];
  private lengths: number[] = [];
  private total = 0;
  private dist = 0;

  constructor(sim: Sim, path: { x: number; z: number }[]) {
    this.sim = sim;
    this.path = path;
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      this.lengths.push(len);
      this.total += len;
    }
    // Locomotive footprint at train pack scale 3: ~4.3 x 5 x 7.8
    this.sim.addKinematicBox("train", { x: 2.2, y: 2.5, z: 4.2 });
  }

  private poseAt(d: number): { x: number; z: number; rotY: number } {
    let rem = ((d % this.total) + this.total) % this.total;
    for (let i = 0; i < this.path.length; i++) {
      const len = this.lengths[i];
      if (rem <= len) {
        const a = this.path[i];
        const b = this.path[(i + 1) % this.path.length];
        const t = len > 0 ? rem / len : 0;
        return {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          rotY: Math.atan2(b.x - a.x, b.z - a.z),
        };
      }
      rem -= len;
    }
    return { x: this.path[0].x, z: this.path[0].z, rotY: 0 };
  }

  tick(dt: number): void {
    this.dist = (this.dist + SPEED * dt) % this.total;
    const { x, z, rotY } = this.poseAt(this.dist);
    this.sim.moveKinematic("train", x, 2.5, z, rotY);
  }

  snap(): CarSnap {
    const { x, z, rotY } = this.poseAt(this.dist);
    return {
      id: "train",
      p: [x, 2.5, z],
      q: [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)],
      v: [0, 0, 0],
      hp: 0,
    };
  }
}
