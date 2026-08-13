// Browser shim: never reached — the build bakes SIX_SIDES_BUILD so the git
// fallback in game.ts short-circuits before calling execSync.
export const execSync = (): string => {
  throw new Error("execSync is not available in the browser");
};
