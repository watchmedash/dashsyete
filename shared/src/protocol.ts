import type { TeamId } from "./types";

export interface InputState {
  seq: number;
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
}

export interface CarSnap {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  hp: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  team: TeamId;
  car: string;
  score: number;
  bot: boolean;
}

export interface Scores {
  teams: [number, number, number, number];
  players: { id: string; score: number }[];
}

export type ClientMsg =
  | { t: "hello"; name: string; car: string; pass: string }
  | { t: "input"; input: InputState };

export type ServerMsg =
  | { t: "welcome"; id: string; team: TeamId; players: PlayerInfo[]; scores: Scores }
  | { t: "join"; player: PlayerInfo }
  | { t: "leave"; id: string }
  | { t: "snapshot"; time: number; lastSeq: number; cars: CarSnap[] }
  | { t: "knockout"; victimId: string; attackerId: string; scores: Scores }
  | { t: "respawn"; id: string }
  | { t: "damage"; id: string; hp: number }
  | { t: "reject"; reason: string };

export function encode(m: ClientMsg | ServerMsg): string {
  return JSON.stringify(m);
}

const clamp1 = (x: unknown) => Math.max(-1, Math.min(1, Number(x) || 0));

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
    const car = String(m.car ?? "").slice(0, 32);
    const pass = String(m.pass ?? "").slice(0, 64);
    return { t: "hello", name, car, pass };
  }
  if (m.t === "input") {
    const i = (m.input ?? {}) as Record<string, unknown>;
    return {
      t: "input",
      input: {
        seq: Math.max(0, Math.floor(Number(i.seq) || 0)),
        throttle: clamp1(i.throttle),
        steer: clamp1(i.steer),
        brake: Math.max(0, clamp1(i.brake)),
        handbrake: Boolean(i.handbrake),
      },
    };
  }
  return null;
}

const SERVER_TYPES = new Set(["welcome", "join", "leave", "snapshot", "knockout", "respawn", "damage", "reject"]);

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
