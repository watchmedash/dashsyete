import { tileToWorld, type CityMap } from "../../shared/src/cityMap";

export type Cell = [number, number];

/**
 * Bot navigation over the map's drivable cells (roads, bridges, plazas,
 * roundabout ring). 4-neighbour BFS on tile coordinates; waypoints are tile
 * centers 12 m apart, so following them keeps a bot on asphalt instead of
 * cutting through building blocks.
 */
export class NavGrid {
  private cells: Set<string>;
  private list: Cell[];
  private centerList: Cell[]; // downtown cells — the free-for-all island

  constructor(map: CityMap) {
    this.list = map.navCells;
    this.cells = new Set(map.navCells.map(([x, z]) => `${x},${z}`));
    this.centerList = map.navCells.filter(
      ([x, z]) => x >= 16 && x < 32 && z >= 16 && z < 32,
    );
  }

  has(gx: number, gz: number): boolean {
    return this.cells.has(`${gx},${gz}`);
  }

  toWorld([gx, gz]: Cell): { x: number; z: number } {
    return { x: tileToWorld(gx), z: tileToWorld(gz) };
  }

  /** Drivable cell nearest to a world position. */
  nearest(x: number, z: number): Cell {
    let best: Cell = this.list[0];
    let bestDist = Infinity;
    for (const c of this.list) {
      const p = this.toWorld(c);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /** A random drivable cell; bias toward downtown keeps fights converging. */
  randomDestination(rng: () => number = Math.random): Cell {
    const pool = rng() < 0.6 ? this.centerList : this.list;
    return pool[Math.floor(rng() * pool.length)];
  }

  /**
   * Shortest cell path (BFS, 4-neighbour) from `from` to `to`, inclusive of
   * both. Null when unreachable (shouldn't happen — the network is connected).
   */
  path(from: Cell, to: Cell): Cell[] | null {
    const key = (c: Cell) => `${c[0]},${c[1]}`;
    if (!this.cells.has(key(from)) || !this.cells.has(key(to))) return null;
    if (from[0] === to[0] && from[1] === to[1]) return [from];
    const cameFrom = new Map<string, string>();
    cameFrom.set(key(from), "");
    const queue: Cell[] = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const next: Cell = [cur[0] + dx, cur[1] + dz];
        const nk = key(next);
        if (!this.cells.has(nk) || cameFrom.has(nk)) continue;
        cameFrom.set(nk, key(cur));
        if (next[0] === to[0] && next[1] === to[1]) {
          // walk back
          const out: Cell[] = [next];
          let k = key(cur);
          while (k !== "") {
            const [x, z] = k.split(",").map(Number);
            out.push([x, z]);
            k = cameFrom.get(k)!;
          }
          return out.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }
}
