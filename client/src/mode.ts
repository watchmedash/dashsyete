/**
 * Build/runtime mode flags.
 *
 * SOLO: the whole game runs on this device — the authoritative server lives
 * in a web worker (see soloWorker.ts). Baked into the mobile APK build via
 * the __SOLO_BUILD__ define; testable in a browser with `?solo`.
 *
 * Solo implies the desktop single-player conventions: no leaderboard, the
 * first chosen name is permanent, and no kill toasts.
 */
declare const __SOLO_BUILD__: boolean | undefined;

/** The game is currently a SINGLE-PLAYER PLANET EXPLORER (user pivot
 * 2026-08-15): every build runs the solo worker server in explore mode.
 * `?net` is the dev escape hatch back to the dormant online battle server. */
export const isSolo = !new URLSearchParams(location.search).has("net");
