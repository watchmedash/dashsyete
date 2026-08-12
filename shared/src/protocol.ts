export interface InputState {
  seq: number;
  moveX: number; // strafe, camera-relative, [-1,1]
  moveZ: number; // forward, camera-relative, [-1,1]
  yaw: number; // camera yaw, wrapped ±π (client-authoritative aim)
  aimPitch: number; // clamped ±1.55 rad (straight down/up allowed)
  jump: boolean;
  sprint: boolean;
  fire: boolean;
  /** Throw a grenade (edge-triggered server-side). */
  nade: boolean;
  /** Swap between the two weapon slots (edge-triggered server-side). */
  swap: boolean;
  /** Selected HOTBAR slot 1-5 (gun pickups replace the gun you're holding:
   * slot 1 selected → first gun, anything else → the pickup gun slot). */
  sel?: number;
}

export interface CharSnap {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  hp: number;
  weapon: string;
  grounded: boolean;
  /** Grenade count (players only; crates reuse this shape with hp as armed flag). */
  nades?: number;
  /** Active-slot ammo (own char; Infinity is sent as -1). */
  ammo?: number;
  /** The OTHER slot's weapon id, "" if empty (own char). */
  slot2?: string;
  /** Which gun slot is active, 0 or 1 (own char) — maps weapon/slot2 onto
   * hotbar cells 1/2 correctly now that BOTH slots are replaceable. */
  aslot?: number;
  /** Building-block stock (own char, v5 voxel mode). */
  blocks?: number;
  /** Creative-style flight active (planet grassland face). */
  fly?: boolean;
}

export interface DartSnap {
  id: string;
  p: [number, number, number];
  v: [number, number, number];
  owner: string;
}

export interface PlayerInfo {
  id: string;
  name: string;
  skin: string;
  score: number;
  deaths?: number;
}

export interface Scores {
  players: { id: string; score: number; deaths?: number }[];
}

export type ClientMsg =
  | { t: "hello"; name: string; skin: string; key: string }
  | { t: "input"; input: InputState }
  | { t: "unstuck" }
  // Build/destroy intent (v5 voxel mode): b=0 break the aimed block, else
  // place (server forces the build block). Validated server-side (reach,
  // stock, mining rate).
  | { t: "blockEdit"; x: number; y: number; z: number; b: number };

export type ServerMsg =
  // `key` is present ONLY when this login just created the name — the client
  // must store it; it is the sole proof of ownership from then on.
  // `v` is the server's build hash: a client on a different build reloads.
  // `vox` = the current voxel world as RLE (v5 sky-island mode).
  | { t: "welcome"; id: string; players: PlayerInfo[]; scores: Scores; key?: string; v?: string; vox?: string }
  | { t: "join"; player: PlayerInfo }
  | { t: "leave"; id: string }
  | { t: "snapshot"; time: number; lastSeq: number; chars: CharSnap[]; darts: DartSnap[] }
  | { t: "knockout"; victimId: string; attackerId: string; scores: Scores }
  | { t: "respawn"; id: string }
  | { t: "damage"; id: string; hp: number; attackerId: string; headshot?: boolean }
  /** Authoritative block edits, batched: [x, y, z, blockId][]. */
  | { t: "block"; e: [number, number, number, number][] }
  | { t: "reject"; reason: string };

export function encode(m: ClientMsg | ServerMsg): string {
  return JSON.stringify(m);
}

const clamp1 = (x: unknown) => Math.max(-1, Math.min(1, Number(x) || 0));

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function decodeClient(s: string): ClientMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.t === "hello") {
    const name = String(m.name ?? "").trim().slice(0, 16) || "Player";
    const skin = String(m.skin ?? "").slice(0, 32);
    const key = String(m.key ?? "").slice(0, 64);
    return { t: "hello", name, skin, key };
  }
  if (m.t === "unstuck") return { t: "unstuck" };
  if (m.t === "blockEdit") {
    return {
      t: "blockEdit",
      x: Math.floor(Number(m.x) || 0),
      y: Math.floor(Number(m.y) || 0),
      z: Math.floor(Number(m.z) || 0),
      b: Math.max(0, Math.min(31, Math.floor(Number(m.b) || 0))),
    };
  }
  if (m.t === "input") {
    const i = (m.input ?? {}) as Record<string, unknown>;
    return {
      t: "input",
      input: {
        seq: Math.max(0, Math.floor(Number(i.seq) || 0)),
        moveX: clamp1(i.moveX),
        moveZ: clamp1(i.moveZ),
        yaw: wrapPi(Number(i.yaw) || 0),
        aimPitch: Math.max(-1.55, Math.min(1.55, Number(i.aimPitch) || 0)),
        jump: Boolean(i.jump),
        sprint: Boolean(i.sprint),
        fire: Boolean(i.fire),
        nade: Boolean(i.nade),
        swap: Boolean(i.swap),
        sel: Math.max(1, Math.min(5, Math.floor(Number(i.sel) || 1))),
      },
    };
  }
  return null;
}

const SERVER_TYPES = new Set(["welcome", "join", "leave", "snapshot", "knockout", "respawn", "damage", "block", "reject"]);

export function decodeServer(s: string): ServerMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as { t?: unknown };
  if (typeof m.t !== "string" || !SERVER_TYPES.has(m.t)) return null;
  return raw as ServerMsg;
}
