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

export const isSolo =
  (typeof __SOLO_BUILD__ !== "undefined" && __SOLO_BUILD__) ||
  new URLSearchParams(location.search).has("solo");
