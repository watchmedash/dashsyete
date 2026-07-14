# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dash City — a multiplayer 3D car-combat arena in the browser. Players drive Kenney low-poly cars around a **5-island archipelago**: four themed team islands (Crimson uptown N, Azure harbor E, Emerald suburbs S, Violet old town W) around a downtown free-for-all center island, linked by 8 bridges (4 spokes + a ring via corner islets) over open sea. Car-vs-car impacts deal HP damage; knockouts score for attacker + team; falling in the sea or flipping = free respawn. Endless session, dual leaderboards, desktop (WASD/arrows + Space) and mobile (touch).

Specs: `docs/superpowers/specs/2026-07-12-dash-city-design.md` (v1 rules) + `2026-07-13-dash-city-islands-design.md` (map v2).
Plans: `docs/superpowers/plans/`.

## Commands

- `npm run assets` — copy GLBs from the `kenney_*` packs into `client/public/assets/` (run once after clone; the packs and copied assets are git-ignored)
- `npm run dev` — game server (tsx watch, :8080) + Vite client dev server (:5173/5174)
- `npm test` — Vitest suite (shared logic + server combat/roster/bots + physics behavior tests)
- `npx vitest run <file>` — single test file
- `npm run typecheck` — `tsc --noEmit` over client/server/shared
- `npm run start` — production: build client, then one Node process serves static files + WebSocket on :8080 (this is the VPS deployment: `npm ci && npm run assets && npm run start`)

Useful diagnostics in `scripts/`: `fake-client.mjs` / `fake-client2.mjs` (drive a headless player), `spectate.mjs <name>` (watch a player's server-side position), `check-train.mjs`, and physics probes `probe-feel.mts` / `probe-steer.mts` / `probe-idle-spawns.mts` / `probe-tbone.mts` / `probe-spawns.mts` / `probe-wake.mts` / `probe-road-blockers.mts` / `probe-brake-wall.mts` / `probe-reverse.mts` (quantify driving feel, steering smoothness, idle stillness, impact launches, spawn clearance, sleep-wake, road obstructions, brake distance + wall-slam composure, reverse-gear stability — run after ANY sim/vehicle/map change), plus `smoke-drive.mjs` (live-server drive check) and `probe-spot.mts <x> <z>` (what's at a world position).

## Architecture

Three packages, one `package.json` (no workspaces), imports by relative path:

- **`shared/src/`** — the single source of truth consumed by BOTH client and server: gameplay constants (`constants.ts` — never inline gameplay numbers elsewhere), damage formula, team assignment, bot names, wire protocol (+ validation/clamping), the data-driven city map, vehicle tuning, and the Rapier simulation (`sim.ts`).
- **`server/src/`** — authoritative game: `game.ts` (ws sessions, 60 Hz tick, 20 Hz snapshots, respawns, world hazards), `combat.ts` (HP/knockouts/scoring), `players.ts` (roster; team scores survive leavers), `train.ts`, `static.ts`.
- **`client/src/`** — rendering + input: `city.ts`/`assets.ts` (GLB loading), `net.ts`, `interp.ts` (remote cars render ~100 ms behind), `prediction.ts` (own car in a mirror Rapier world with REWIND+REPLAY reconciliation — see netcode invariant below), `cars.ts` (models, name labels, team underglow), `camera.ts`, `input.ts`/`touch.ts`, `ui/` (join screen, HUD, leaderboards).

**Key invariants:**

- Server-authoritative: clients send only `{seq, throttle, steer, brake, handbrake}` inputs (clamped in `protocol.ts`); positions come only from server snapshots.
- Netcode contract (don't break any leg or prediction visibly yanks): client sends EVERY 60 Hz input; the server queues them and applies ONE PER TICK in order, setting `lastInputSeq` when APPLIED (not received); snapshots carry that `lastSeq`; the client rewinds to the snapshot state and replays its unacked inputs. The old soft-blend correction caused a 20 Hz "push and pull" while driving. Two hardening layers on top (both matter): the server never drops inputs on steady-state timer jitter — the queue breathes 0..3 and every dropped input shears the replay one tick (~0.5 m yank at speed); it sheds only a >4-tick backlog, in one splice — and the client folds sub-2 m correction error into a render-only decaying offset (`prediction.off` — x/z + yaw ONLY, never y: offsetting y sinks the displayed car into the road after a wall-hit misprediction; the sim adopts corrections fully, only the displayed pose glides). Correction telemetry: `window.__predErr`.
- Hazard respawns (sea, flip) teleport to the NEAREST clear road tile (`game.nearestRoadRespawn`), facing along the road toward downtown — never all the way back to the team plaza. Knockout respawns still use the team spawn slots.
- Every visible decor object reacts to cars: sturdy pieces (gravestones, parasols, planters, trees, coffin) have static colliders; organic bits (pumpkins, hay bales) are knockable dynamic props. Don't add drive-through ghost decor.
- Accounts: `server/src/accounts.ts` (scrypt hashes) persists to `data/players.json` (git-ignored). `hello` carries `pass`; failures come back as `{t:"reject", reason}`. Team + score restore on login; the join-screen car pick wins.
- Client input feel: joystick mapping + auto-drift are pure functions in `client/src/joystick.ts` (unit-tested); free-look orbit state in `client/src/look.ts` (pointer lock w/ drag fallback on desktop, swipe on mobile). Own car has no name label; remote labels are depth-tested.
- The map (`shared/src/cityMap.ts`, `buildCityMap()`) is deterministic and drives BOTH client visuals and server colliders — change geometry there, never in one side only. The north island is built once and stamped 4× by quarter-turn rotation; road tiles pick model+rotation from a neighbour-based classifier. Ground is per-landmass slabs (`map.grounds`) — the sea has no floor.
- Building/prop colliders come from `shared/src/modelFootprints.ts` (measured GLB bounding boxes — see `scripts/measure-footprints.mjs` for how to re-measure after adding models). Never guess a footprint. Models are placed by bbox CENTER (not pivot) — several Kenney models are badly off-center.
- Road piece rotations (`BEND_ROT`/`TEE_ROT`/`END_ROT` in `cityMap.ts`) were MEASURED by raycasting the road surface at tile-edge midpoints (0.12 = open lane, 0.24 = curb); the `DEBUG_ROADS` strip re-creates the measuring rig. Don't re-guess them.
- Road models carry their lane surface 0.12 above the model base; tiles sink by `ROAD_LANE_Y` (0.10 — slightly less than 0.12 or the lane z-fights the ground slab top) so tires don't visually cut into the lane.
- Same-team collisions deal zero damage; only car-vs-car impacts damage (walls/props/ship never do). Damage is DIRECTIONAL: your front (±60°) is your weapon — the frontal car deals damage and takes none; head-on clashes are free for both. Impact damage uses **pre-step** velocities (see `sim.step()`).
- Impact relative speed maps to damage in `shared/src/damage.ts` (free bumps below `DAMAGE_MIN_SPEED`).
- There are NO bots (removed at user request 2026-07-13 — don't reintroduce without asking); every roster player is a human with a socket.
- Dynamic props (`prop-<n>`) and the cargo ship (`ship`) ride the car-snapshot pipeline (props with real velocities); neither can deal damage (impact events only fire for car-collider pairs). Props are ALSO mirrored inside the client prediction world (synced each snapshot, resimulated locally) and RENDERED from there — rendering them from the ~100 ms interp buffer while the own car renders from instant prediction makes every pushed prop visually lag inside the car ("passing through objects"). The ship stays on interp (cars can't reach the open sea).

**Physics gotchas (hard-won, don't rediscover):**

- Rapier's `DynamicRayCastVehicleController` defaults to `indexForwardAxis = 0` (x); our cars are z-forward — `sim.ts` sets it via the oddly-named setter property `setIndexForwardAxis = 2`.
- `setAdditionalMassProperties` silently kills contact-force events — the anti-flip low center of mass is a dense ballast slab collider instead, and it must stay SMALLER than the chassis footprint or it absorbs car-car contacts (only the chassis collider carries the event flag).
- `road-bridge` is an elevated overpass model (deck at 6.12 m); the map sinks it so the deck meets the flat physics deck at y=0.
- Impact damage uses PRE-step velocities and short approach distances in tests (long approaches drift into misses).
- Positive steering/yaw rotates +z toward +x ("left" on screen behind the car). `wheelSideFrictionStiffness` defaults to 1 = ice; we use 1.5 — and 1.5 is a CLIFF EDGE: at >= 1.75 the side-friction solver overshoots every tick, the heading buzzes with a ±2.5°/tick seesaw (reads as "uncontrollable"), and hard turns scrub ALL speed. The ballast slab must also stay LONG in z (yaw inertia vs the seesaw) but NARROW in x (a wide slab edge is a trip-flip pivot on broadsides). Verify with `scripts/probe-steer.mts` after touching either.
- Building models can be BIGGER than a tile (commercial `building-e` is 19.7 m on a 12 m tile) — their colliders bulge into streets as invisible walls that stop cars dead. `fitsTile()` filters every building list at build time; `scripts/probe-road-blockers.mts` scans all road tiles for collider intrusions. Run it after any map dressing change.
- Kenney packs have wildly different native scales — per-pack factors live in `MODEL_SCALES` (`shared/src/constants.ts`), measured from GLB bounding boxes; some models span multiple tiles and are excluded from the map's model lists.
- A raycast vehicle with zero throttle has NO longitudinal friction: at float-dependent positions/headings, side-friction impulses feed a slow yaw+creep instability — an idle car "walks" ~0.3 m/s and shakes (server and prediction walk out of phase, so corrections jitter). `sim.step()` therefore sleeps idle+still cars after 10 quiet ticks (all wheels grounded — never mid-air), bleeds idle crawl velocity, applies a speed-gated parking brake, and applies gentle engine braking (`COAST_BRAKE`) at rolling speeds so a released throttle coasts down (~3 m/s²) instead of cruising forever. Don't remove any of the four layers; keep `COAST_BRAKE` well under `BRAKE_FORCE` (a hard-braked victim trips over its own wheels — `probe-tbone.mts`). The flip side of sleeping: driving input must call `wakeUp()` explicitly — the vehicle controller pumps velocity into a sleeping body WITHOUT waking it (stored linvel, no integration, car frozen). Forward throttle happens to punch through Rapier's wake threshold; reverse does not.
- Reverse gear needs HALF steering lock: full lock while backing up makes the steered front wheels slide broadside, the side-friction solver scrubs all reverse speed (stall at ~1 m/s) and fights itself (shake). Measured by `scripts/probe-reverse.mts` — smooth 11.7 m/s reverse arcs at 0.5× lock.
- The `MAX_POP_VY`/`MAX_TUMBLE` clamps double as the car's "weight"; `TUMBLE_BLEED` additionally drains roll/pitch rate each tick while upright (a rate cap alone lets a sustained shove wind the car past 45°). The bleed is gated on upY > 0.5 — ungated, flipped cars can't self-right.
- Broadside wedge geometry (rounded nose under a chassis) produces chaotic, unbounded launch/roll impulses; `sim.step()` clamps upward velocity (`MAX_POP_VY`) and roll/pitch rate (`MAX_TUMBLE`) after every world step. These clamps double as the "weight" of the car — loosening them makes every wall tap rear the car up.
- S/↓ maps to `throttle = -1`, and the reverse engine tapers to ZERO above 12 m/s — so `sim.step()` turns negative throttle into wheel brakes (`BRAKE_FORCE`) while the car rolls forward (> 2 m/s longitudinal). Remove that swap and the brake pedal does nothing at speed. Measured by `scripts/probe-brake-wall.mts` (stop from top speed ~2.6 s / 36 m).
- Client game logic (input + prediction) runs through a shared `pump()` driven by BOTH the rAF loop (vsync-phased stepping so the accumulator remainder is a clean render-interpolation alpha) and a `setInterval` fallback — rAF is throttled to ~1 fps in occluded/background windows (this also affects Playwright-driven testing; timers throttle too, the accumulator catches up). The own car renders `lerp(prev, curr, alpha)` between the last two physics states ("Fix Your Timestep"): drawing the raw or lazily-smoothed pose beats rhythmically at speed (0..2 steps per frame — the "takak takak" judder). Frame-pace telemetry: set `window.__trace = []` and read it back.

## Testing notes

- Physics/behavior tests (`shared/src/sim.test.ts`) run real Rapier in Node — keep car approach distances short in collision tests (long approaches drift into misses).
- Playtest locally with multiple browser tabs; `scripts/fake-client.mjs <name>` adds headless drivers to make combat observable.
