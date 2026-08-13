// Browser shim: the solo worker's score store starts empty, never persists
// (solo has no leaderboard). See shims/README in vite.config.ts aliases.
export default {
  existsSync: (): boolean => false,
  readFileSync: (): string => "[]",
  writeFileSync: (): void => {},
  mkdirSync: (): void => {},
};
