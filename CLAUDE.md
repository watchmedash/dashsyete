# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dash City v4 — a multiplayer on-foot **blaster deathmatch** in the browser (long-term goal: battle royale; rounds/zone come later). Players are Kenney blocky characters running through a **Manhattan-style downtown island** built exclusively from the Quaternius **Downtown City MegaKit** (real-meter scale): a 5×5 grid of city blocks on a 48 m pitch, 12 m `Street_2Lane` streets with baked sidewalks, prefab brick/metal towers (Building_Small_1 / Building_Medium_2_001 / Building_Large_2) fronting each block with hash-varied slides that open alleys into the courtyards, courtyard props (planters, bollards, AC units), a paved promenade rim, open sea all around the island. Free-for-all: foam-dart blasters (flat damage per weapon), grenade pickups, knockouts score on a personal leaderboard, respawns, endless drop-in session. There is NO driving and (since v4) no parked cars. Desktop (WASD + mouse aim, pointer lock) and mobile (joystick + fire/jump buttons + swipe aim). V cycles camera: 3rd-back / 1st-person / 3rd-front (crosshair hides in 3rd-front).

Specs: `docs/superpowers/specs/2026-08-11-city-blaster-deathmatch-design.md` (v3) — earlier car-era specs are historical.
Plan: `docs/superpowers/plans/2026-08-11-city-blaster-deathmatch.md`.

## Commands

- `npm run assets` — copy assets into `client/public/assets/`: Downtown MegaKit gltf+textures → `assets/downtown/`, survival FBX, remaining `kenney_*` packs (characters, blasters, watercraft), touch-control sprites (run once after clone; source packs + copied assets are git-ignored)
- `npm run dev` — game server (tsx watch, :8080) + Vite client dev server (:5173/5174)
- `npm test` — Vitest suite (shared sim/map/protocol/weapons/projectiles + server combat/roster/accounts/respawn)
- `npx vitest run <file>` — single test file
- `npm run typecheck` — `tsc --noEmit` over client/server/shared/scripts
- `npm run start` — production: build client, then one Node process serves static files + WebSocket on :8080 (VPS deploy: `npm ci && npm run assets && npm run start`)

Diagnostics in `scripts/`: `fake-client.mjs <name> [--shoot|--idle]` (headless player: patrols, or aims+fires at the nearest player), `spectate.mjs <name>`, `probe-road-blockers.mts` (street clearance scan), `probe-spot.mts <x> <z>` (what's at a world position), `measure-glb.mjs <pack> [models…]` (Node GLB bbox measurement — no browser needed). Client debug URLs: `?fly[=x,z,h,d]` (city fly-over), `?skins` (all-18 character cast sheet), `?debug=1` (live smoothness overlay). Browser hooks: `__vel()`, `__input()`, `__cam()`, `__predErr`, `__trace`.

## Architecture

Three packages, one `package.json` (no workspaces), imports by relative path:

- **`shared/src/`** — single source of truth for BOTH client and server: `constants.ts` (all gameplay numbers — never inline elsewhere; also `SKIN_NAMES`), `character.ts` (movement tuning), `weapons.ts` (weapon table, grenade falloff), `protocol.ts` (wire types + validation/clamping), `cityMap.ts` (data-driven map), `projectiles.ts` (dart/grenade stepping), `sim.ts` (Rapier character simulation), `modelFootprints.ts` (measured GLB boxes).
- **`server/src/`** — authoritative game: `game.ts` (ws sessions, 60 Hz tick, 20 Hz snapshots, fire/pickup/hazard handling), `combat.ts` (dart/explosion damage, knockouts, regen, respawns), `players.ts` (roster), `accounts.ts` (scrypt hashes → `data/players.json`, git-ignored), `ship.ts` (decor cargo ship), `static.ts`.
- **`client/src/`** — rendering + input: `city.ts`/`assets.ts` (GLB loading; `loadModelWithClips` for animated characters), `net.ts`, `interp.ts` (remotes ~100 ms behind), `prediction.ts` (own character in a mirror Rapier world, REWIND+REPLAY), `chars.ts` (skins, Kenney node animations, blaster attach, labels, crates), `darts.ts` (projectile rendering + extrapolation), `camera.ts` (3-mode shooter camera), `input.ts`/`touch.ts`/`look.ts`/`joystick.ts`, `ui/` (join showroom, HUD, leaderboard).

**Key invariants:**

- Server-authoritative: clients send only `{seq, moveX, moveZ, yaw, aimPitch, jump, sprint, fire, nade}` (clamped in `protocol.ts`; yaw/aimPitch are client-authoritative aim). Positions come only from server snapshots.
- Netcode contract (don't break any leg or prediction visibly yanks): client sends EVERY 60 Hz input; the server queues them and applies ONE PER TICK in order, setting `lastInputSeq` when APPLIED (not received); snapshots carry that `lastSeq`; the client rewinds to the snapshot state and replays unacked inputs. The server never drops inputs on steady-state timer jitter (sheds only a >4-tick backlog, in one splice) and rebuffers to 2 queued inputs after a starve. The client folds sub-2.5 m correction error into a render-only decaying offset (x/z + yaw ONLY, never y; slow 2%/tick decay; soft rescale at 3 m). Fixed-timestep render interpolation on the own character (pump driven from rAF + timer fallback). Correction telemetry: `__predErr`; measured ~0.4 mm avg on loopback.
- Combat: server-stepped darts (segment-vs-capsule + static-world raycast, owner-immune, ~1 s life) and grenades (bounce + fuse + radial falloff, no self-damage). Flat per-weapon damage from `weapons.ts`. Spawn protection blocks dealing AND taking. Fire is edge-triggered for semi-auto, held for auto; cooldowns are server-enforced in ticks.
- Pickups: crate spawns in the map grant weapons (or +3 grenades); rearm after `CRATE_RESPAWN_S`. Crate state rides the snapshot as `crate-<n>` pseudo-entities (hp 1=armed, 0=rearming; weapon = contents).
- Hazard respawn: falling into the sea (or 🆘 unstuck, 5 s cooldown) teleports to the NEAREST clear `Street_2Lane` tile center. Knockout respawns pick the clear spawn point farthest from living enemies.
- The map (`shared/src/cityMap.ts`, `buildCityMap()`) is deterministic and drives BOTH client visuals and server colliders — change geometry there, never in one side only. v4 downtown uses ONLY the Downtown City MegaKit (loose `.gltf` files in `assets/downtown/`; `client/src/assets.ts` loads that pack with the `.gltf` extension instead of `.glb`). Street modules top out at y=0; the baked 0.15 m sidewalks are mirrored as long curb-strip box colliders per street side. The island is one ground slab; the sea has no floor. `parkedCars` is empty in v4 (interface + `parkedCarCollider()` kept for stability).
- Building/prop colliders come from `modelFootprints.ts` (measured — `scripts/measure-glb.mjs`; never guess). Downtown models place by PIVOT (front-door origin, NOT bbox center); `footprintCollider()`/`rotatedOffset()` apply the measured bbox-center offset so colliders land on the mesh. Keep `probe-road-blockers` clean after any map dressing change.
- Every visible decor object reacts: courtyard/promenade props (planters, bollards, AC units) carry static footprint colliders — no drive-through ghost decor. The sim still supports knockable dynamic props mirrored inside client prediction and RENDERED from there (interp-rendered props visually lag against the predicting own character); the v4 map ships none.
- Accounts: `hello` carries `pass`; failures come back as `{t:"reject", reason}`. Score + skin restore on login; the join-screen pick wins.
- NO bots (user decision 2026-07-13); every roster player is a human with a socket. `fake-client.mjs` is a test tool, not a bot.
- NO drivable vehicles (user decision 2026-08-11) — don't reintroduce without asking.

**Physics gotchas (hard-won, don't rediscover):**

- Rapier kinematic character controller: **always-on autostep stalls on open flat ground** at speed (movement computes to ~zero at deterministic positions). `sim.step()` computes movement with autostep OFF and re-runs with it ON only when the plain pass was actually blocked (a real curb). Don't re-enable it globally.
- The controller **refuses to slide along kinematic-body ground** (blocks all horizontal movement above ~4 m/s). Map ground must be FIXED bodies; tests use `addStaticBox` platforms at altitude, never `addKinematicBox` floors.
- Idle characters creep: the controller emits micrometre penetration-recovery slides every tick. `sim.step()` suppresses BOTH the applied horizontal movement and the adopted velocity when desired horizontal movement is ~zero.
- Raycasts (`castRayStatic*`) only see colliders after a `world.step()` — the query pipeline updates during stepping. A fresh Sim must step once before projectile tests.
- Character velocity is manual: gravity integrates by hand (`GRAVITY` in `character.ts`), the collision-resolved movement is adopted back as velocity (so walls stop you and the wire velocity matches reality), grounded zeroes downward vy, and a blocked upward movement zeroes a jump ("head bonk").
- Wire yaw convention: forward = `(sin yaw, cos yaw)`; screen-right looking along +forward is world `(-cos yaw, 0, sin yaw)` — that's why D maps to `moveX = -1` and mouse-right DECREASES yaw. The server muzzle/aim math in `game.ts` and the client camera/`joystick.ts` must stay consistent.
- Kenney blocky characters are NOT skinned but carry **named node-transform animation clips** (idle/walk/sprint/die/holding-*, etc.) — `AnimationMixer` on a plain hierarchy clone works (bindings resolve by node name). The v3 client crossfades idle/walk/sprint by observed speed and overrides the `arm-right` node rotation after `mixer.update()` for aim pitch.
- Client pump: game logic runs through `pump()` driven by BOTH rAF (vsync-phased) and a `setInterval` fallback (rAF throttles in background tabs; this affects Playwright too). Own character renders `lerp(prev, curr, alpha)` between the last two physics states.

## Testing notes

- Physics/behavior tests (`sim.test.ts`, `projectiles.test.ts`) run real Rapier in Node on floating static platforms at (500, 50, 500) — map-independent by design.
- `respawn.test.ts` boots a real `Game` on an ephemeral port and verifies pickups end-to-end against the live 60 Hz interval.
- Playtest locally with multiple browser tabs; `scripts/fake-client.mjs <name> --shoot` adds a headless combatant.
- Playwright testing: browser keyboard events need the page focused (`bringToFront` + canvas click) — otherwise dispatch `KeyboardEvent` via `evaluate`. Some synthetic events carry no `e.code` (input.ts guards against this).
