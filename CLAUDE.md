# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dash City — a multiplayer 3D car-combat arena in the browser. Players (plus 20 bots, 5 per team) drive Kenney low-poly cars around a themed city; car-vs-car impacts deal HP damage; knockouts score points for the attacker and their team. Endless session, dual leaderboards (teams + individuals), playable on desktop (WASD/arrows + Space) and mobile (touch controls).

Design spec: `docs/superpowers/specs/2026-07-12-dash-city-design.md`
Implementation plan: `docs/superpowers/plans/2026-07-12-dash-city.md`

## Commands

- `npm run assets` — copy GLBs from the `kenney_*` packs into `client/public/assets/` (run once after clone; the packs and copied assets are git-ignored)
- `npm run dev` — game server (tsx watch, :8080) + Vite client dev server (:5173/5174)
- `npm test` — Vitest suite (shared logic + server combat/roster/bots + physics behavior tests)
- `npx vitest run <file>` — single test file
- `npm run typecheck` — `tsc --noEmit` over client/server/shared
- `npm run start` — production: build client, then one Node process serves static files + WebSocket on :8080 (this is the VPS deployment: `npm ci && npm run assets && npm run start`)

Useful diagnostics in `scripts/`: `fake-client.mjs` / `fake-client2.mjs` (drive a headless player), `spectate.mjs <name>` (watch a player's server-side position), `watch-bots.mjs <sec>` (arena activity summary), `bot-positions.mjs`, `trace-bot.mjs`, `check-train.mjs`.

## Architecture

Three packages, one `package.json` (no workspaces), imports by relative path:

- **`shared/src/`** — the single source of truth consumed by BOTH client and server: gameplay constants (`constants.ts` — never inline gameplay numbers elsewhere), damage formula, team assignment, bot names, wire protocol (+ validation/clamping), the data-driven city map, vehicle tuning, and the Rapier simulation (`sim.ts`).
- **`server/src/`** — authoritative game: `game.ts` (ws sessions, 60 Hz tick, 20 Hz snapshots, respawns, world hazards), `combat.ts` (HP/knockouts/scoring), `players.ts` (roster; team scores survive leavers), `bots.ts` (cruise/hunt/stuck AI), `train.ts`, `static.ts`.
- **`client/src/`** — rendering + input: `city.ts`/`assets.ts` (GLB loading), `net.ts`, `interp.ts` (remote cars render ~100 ms behind), `prediction.ts` (own car simulated locally in a mirror Rapier world, softly reconciled), `cars.ts` (models, name labels, team underglow), `camera.ts`, `input.ts`/`touch.ts`, `ui/` (join screen, HUD, leaderboards).

**Key invariants:**

- Server-authoritative: clients send only `{seq, throttle, steer, brake, handbrake}` inputs (clamped in `protocol.ts`); positions come only from server snapshots.
- The city map (`shared/src/cityMap.ts`, `buildCityMap()`) is deterministic and drives BOTH client visuals and server colliders — change geometry there, never in one side only.
- Same-team collisions deal zero damage; only car-vs-car impacts damage (walls/props/train never do). Impact damage uses **pre-step** velocities (see `sim.step()`).
- Impact relative speed maps to damage in `shared/src/damage.ts` (free bumps below `DAMAGE_MIN_SPEED`).
- Bots are ordinary roster players (`bot: true`) producing ordinary inputs; they're excluded from human team balancing and have no sockets.

**Physics gotchas (hard-won, don't rediscover):**

- Rapier's `DynamicRayCastVehicleController` defaults to `indexForwardAxis = 0` (x); our cars are z-forward — `sim.ts` sets it via the oddly-named setter property `setIndexForwardAxis = 2`.
- Positive steering/yaw rotates +z toward +x ("left" on screen behind the car). `wheelSideFrictionStiffness` defaults to 1 = ice; we use 4.
- Kenney packs have wildly different native scales — per-pack factors live in `MODEL_SCALES` (`shared/src/constants.ts`), measured from GLB bounding boxes; some models span multiple tiles and are excluded from the map's model lists.
- Client game logic (input + prediction) runs on `setInterval`, not rAF — rAF is throttled to ~1 fps in occluded/background windows (this also affects Playwright-driven testing; timers throttle too, the accumulator catches up).

## Testing notes

- Physics/behavior tests (`shared/src/sim.test.ts`) run real Rapier in Node — keep car approach distances short in collision tests (long approaches drift into misses).
- Playtest locally with multiple browser tabs; bots make combat observable immediately (`scripts/watch-bots.mjs 60` asserts arena health: expect most cars moving, damage events, and knockouts).
