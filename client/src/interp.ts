import * as THREE from "three";
import { INTERP_DELAY_MS } from "../../shared/src/constants";
import type { CharSnap } from "../../shared/src/protocol";

interface Snapshot {
  time: number;
  cars: Map<string, CharSnap>;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/**
 * Buffers server snapshots and samples car transforms INTERP_DELAY_MS behind
 * the newest snapshot so remote cars move smoothly despite 20 Hz updates.
 */
export class Interpolator {
  private buffer: Snapshot[] = [];

  push(time: number, cars: CharSnap[]): void {
    this.buffer.push({ time, cars: new Map(cars.map((c) => [c.id, c])) });
    if (this.buffer.length > 40) this.buffer.shift();
  }

  latestTime(): number | null {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].time : null;
  }

  /** Latest known HP per car id (from the newest snapshot). */
  latestHp(id: string): number | null {
    const last = this.buffer[this.buffer.length - 1];
    return last?.cars.get(id)?.hp ?? null;
  }

  sample(): Map<string, { p: [number, number, number]; q: [number, number, number, number] }> {
    const out = new Map<string, { p: [number, number, number]; q: [number, number, number, number] }>();
    if (this.buffer.length === 0) return out;

    const renderTime = this.buffer[this.buffer.length - 1].time - INTERP_DELAY_MS / 1000;

    // Find bracketing snapshots
    let older = this.buffer[0];
    let newer = this.buffer[this.buffer.length - 1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].time <= renderTime && this.buffer[i + 1].time >= renderTime) {
        older = this.buffer[i];
        newer = this.buffer[i + 1];
        break;
      }
    }

    const span = newer.time - older.time;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - older.time) / span)) : 1;

    for (const [id, b] of newer.cars) {
      const a = older.cars.get(id);
      if (!a) {
        out.set(id, { p: b.p, q: b.q });
        continue;
      }
      const p: [number, number, number] = [
        a.p[0] + (b.p[0] - a.p[0]) * t,
        a.p[1] + (b.p[1] - a.p[1]) * t,
        a.p[2] + (b.p[2] - a.p[2]) * t,
      ];
      qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      qa.slerp(qb, t);
      out.set(id, { p, q: [qa.x, qa.y, qa.z, qa.w] });
    }
    return out;
  }
}
