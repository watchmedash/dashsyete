import { WATER_Y } from "../../shared/src/constants";
import type { CharSnap } from "../../shared/src/protocol";
import type { Sim } from "../../shared/src/sim";

const SPEED = 6; // m/s along the sea loop
const DECK_Y = WATER_Y + 2; // hull rides above the waterline

/**
 * Decorative cargo ship: a kinematic collider sailing the open sea around
 * the archipelago. Blocks anything physically (nothing should reach it) but
 * never deals damage — impact events only fire for car-vs-car pairs.
 */
export class Ship {
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
    // ship-cargo-a at watercraft scale 2.5: ~10 x 8.5 x 26 m
    this.sim.addKinematicBox("ship", { x: 5, y: 4, z: 13 });
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
    this.sim.moveKinematic("ship", x, DECK_Y, z, rotY);
  }

  snap(): CharSnap {
    const { x, z, rotY } = this.poseAt(this.dist);
    return {
      id: "ship",
      p: [x, DECK_Y, z],
      q: [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)],
      v: [0, 0, 0],
      hp: 0,
      weapon: "",
      grounded: false,
    };
  }
}
