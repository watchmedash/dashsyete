import type { TeamId } from "./types";

export function pickTeam(
  humanCounts: [number, number, number, number],
  rand: () => number = Math.random,
): TeamId {
  const min = Math.min(...humanCounts);
  const candidates = [0, 1, 2, 3].filter((t) => humanCounts[t] === min);
  return candidates[Math.floor(rand() * candidates.length)] as TeamId;
}
