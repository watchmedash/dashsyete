# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SIX SIDES** (formerly Dash City; renamed 2026-08-12 — user pick; repo/dir names and `dash-*` localStorage keys intentionally unchanged) — a multiplayer on-foot **voxel cube-planet blaster deathmatch** in the browser. Players are Kenney blocky characters (1.9 m) fighting across a **cube planet of radius 112** (1 m voxels, deterministic seeded generation in `shared/src/skyMap.ts`) with **six-way face gravity** — every face is walkable ground. The six biome faces (zone banners on edge crossings): grassland +Y "THE MEADOW" (flyable via double-jump), volcanic −Y "MAGMA DEEP" (heavy/slow/lava, locked-ish dark), desert +X "SUNSCAR DUNES" (eternal day, cacti prick), antarctic −X "WHITEOUT" (slow snow, ice lakes), forest +Z "DARKROOT" (dense pines), moon −Z "THE FARSIDE" (eternal night, low gravity, high jumps). Sun AND moon orbit the cube (`DAY_CYCLE_S` 3600, server-clock synced); their orbital plane misses the desert/moon faces so those stay locked day/night.

Free-for-all, **50-slot matches**: server bots fill every slot no human uses (solo = vs 49 bots), humans cap at 20. Foam-dart blasters with FINITE ammo, **single gun slot** (4-cell hotbar: 1 gun / 2 destroy tool / 3 grenades / 4 blocks; wheel or digit keys or tap to select), distance damage falloff (snipers flat), 2× headshots, +50 HP on kill, NO natural regen. Minecraft-style timed mining (crack decal), block placing (build cap alt > 30 rejected), water that flows/swims/hides-you/drowns-you slowly, grenades that only explode after ground contact (lit landing marker, ~26 m max-power lob), knockable crates→boxless floating pickups with color-coded beacons, gun drops on pickup swap, per-face block-debt regeneration. Desktop (WASD + pointer lock, Tab leaderboard, U unstuck, RMB scope, V camera cycle, Esc pause/settings) and mobile (joystick + swipe aim + fire/jump/nade/zoom buttons, tappable hotbar). Settings (menu + Esc): sensitivity, volume, FOV — persisted.

Historical: v3 city-map era docs in `docs/superpowers/` are outdated; the city map code (`cityMap.ts`, MegaKit assets, editor) still exists and builds when `customMap.json` has pieces, but the shipped game is the planet.

## Commands

- `npm run assets` — copy assets into `client/public/assets/`: Downtown MegaKit gltf+textures → `assets/downtown/`, survival FBX, remaining `kenney_*` packs (characters, blasters, watercraft), touch-control sprites (run once after clone; source packs + copied assets are git-ignored)
- `npm run dev` — game server (tsx watch, :8080) + Vite client dev server (:5173/5174)
- `npm test` — Vitest suite (92 tests: shared sim/voxel/map/protocol/weapons/projectiles + server combat/roster/accounts/respawn)
- `npx vitest run <file>` — single test file
- `npm run typecheck` — `tsc --noEmit` over client/server/shared/scripts (scripts are typechecked — delete scratch `.mts` probes when done)
- `npm run start` — production: build client, then one Node process serves static files + WebSocket on :8080 (VPS deploy: `npm ci && npm run assets && npm run start`)
- `npm run editor` — standalone Electron MAP BUILDER for the city-map mode (:5199); "Save to Game" writes `shared/src/customMap.json`

Diagnostics in `scripts/`: `fake-client.mjs <name> [--shoot|--idle]`, `spectate.mjs <name>`, `measure-glb.mjs <pack> [models…]`. Client debug URLs: `?fly[=x,z,h,d]` (fly-over; `__cap(x,y,z,tx,ty,tz)` repositions the camera), `?skins`, `?debug=1`, `?editor`, `?touch`. Browser hooks: `__vel()`, `__input()`, `__cam()`, `__pos()` (render pose incl. correction offset), `__aim()`, `__look(yaw,pitch)` (drive aim headless), `__pred()` (correction-offset/bail/snap debug), `__predErr`, `__scene`, `__ri()`/`__deep()`.

## Architecture

Three packages, one `package.json` (no workspaces), imports by relative path:

- **`shared/src/`** — single source of truth for BOTH client and server: `constants.ts` (all gameplay numbers — never inline elsewhere), `character.ts` (movement/fly/fall tuning), `weapons.ts` (weapon table, `GRENADE`), `protocol.ts` (wire types + clamping; `InputState.sel`, `CharSnap.{fly,aslot,blocks}`, `PlayerInfo.bot`), `voxel.ts` (block ids 0-19, `HARDNESS`, chunked `VoxelWorld`), `skyMap.ts` (`BIOMES`, `buildSkyWorld` — deterministic planet gen: terrain, lakes, tree species, spawns, 14 crates/face), `gravity.ts` (face frames, `faceUp` signed-dot hysteresis), `projectiles.ts` (dart/grenade stepping; nades arm fuse on first world contact), `sim.ts` (Rapier character sim: face gravity, double-jump flight, swimming, fall-impact recording, collider streaming), `cityMap.ts` (legacy city mode).
- **`server/src/`** — authoritative game: `game.ts` (ws sessions, drift-compensated 60 Hz tick, 20 Hz snapshots, fire/pickup/blockEdit/hazard, bot AI, `/api/leaderboard`), `combat.ts`, `players.ts`, `accounts.ts` (keyless per-name score store), `static.ts`.
- **`client/src/`** — rendering + input: `voxelRender.ts` (per-chunk instanced cubes, procedural 16×16 textures with edge frames + mipmaps, far-side chunk cull), `weather.ts` (sun/moon orbit, per-face sky/fog/rain/particles, `faceIndexOfUp`), `prediction.ts` (mirror Rapier world, REWIND+REPLAY), `interp.ts`, `chars.ts` (skins, node animations with root-motion stripped, labels/HP bars distance-faded, crate/drop beacons), `darts.ts`, `camera.ts` (face-frame 3-mode camera, smoothed view-up), `sfx.ts` (all-procedural WebAudio: per-biome ambient beds, per-surface footsteps, splash/drip, heartbeat), `settings.ts` (sens/vol/FOV, `settingsPanel()` shared by menu + Esc pause), `input.ts`/`touch.ts`/`look.ts`/`joystick.ts`, `ui/` (join menu, HUD, zone banners, death tint).

**Key invariants:**

- Server-authoritative: clients send only `{seq, moveX, moveZ, yaw, aimPitch, jump, sprint, fire, nade, swap, sel}` (clamped in `protocol.ts`). Positions come only from server snapshots. Block edits are intents (`blockEdit`), validated server-side (reach, build-height cap, FACE-AWARE occupant check) and broadcast as authoritative `block` batches.
- Netcode contract (don't break any leg or prediction visibly yanks): client sends EVERY 60 Hz input; server applies ONE PER TICK, acks `lastSeq`; client rewinds + replays. The rewind also restores jump edge-detection state (`Sim.setEdgeState` from client input history) — without it replays re-derive jumps a full jump height off. Correction error folds into a render-only decaying offset — **FULL 3D** + yaw (the jump axis can be any world axis on the cube), 2%/tick decay, soft rescale at 3 m, snap only > 2.5 m; the >MAX_REPLAY bail ALSO folds (never hard-snaps). Telemetry: `__predErr`, `__pred()`.
- COLLIDER STREAMING (critical perf): Rapier bodies exist only near characters. Budgeted: each character keeps a synchronous safety bubble (own chunk + 6 neighbors); shell chunks stream from queues at 8 adds/16 removals per tick. Humans stream radius 3, bots 1. Bots' controllers step at 20 Hz with 3× dt (`Sim.setStepEvery`, staggered) — matches the snapshot rate, invisible to clients. Server tick measured ~9 ms avg / 17.5 ms p99 of the 16.67 ms budget with 50 bots.
- Combat: server-stepped darts (segment-vs-capsule + static raycast, owner-immune) and grenades (throwSpeed 32 / up 11, fuse 90 ticks armed on FIRST world contact, life 300 backstop, radius 8, craters convert to thrower's blocks). Single gun slot: crate/drop pickups replace slot 0; the replaced non-starter gun drops (`drop-<n>` pseudo-entities, 16 cap, 30 s expiry, step-away lock). Spawn protection blocks dealing AND taking.
- BOTS: 50-slot fill (`Game.start(port, {bots:true})`, index.ts only). Per-bot aggression personality; distance-scaled aim error; LOS check before firing; real 2.2 s reloads; once-per-life retreat when hurt; tactical grenades (lobbed over cover, cooldown); ignore spawn-protected targets; LOOT-RUN to armed crates when idle and keep a short 34 m engagement range until geared (else the wander branch never runs with 50 combatants). Leaderboard marks bots (dimmed + BOT tag).
- Water: `flowWater` bounded BFS seeds only from side/above (never wells up); swimming in sim (`inWater`); one-way transparency (camera-submerged material swap); 1 hp/20 s breathing damage; splash/drip sfx on enter/exit.
- The planet map is deterministic from a seed and drives BOTH client visuals and server colliders — change generation in `skyMap.ts` only. RNG call-count changes reshuffle the whole layout (fine, but tests/spawns recompute).
- Accounts: KEYLESS — `data/players.json` per-name score/skin store; online name collision auto-suffixes ("Zed" → "Zed2"). Bots never write scores.
- Stale-tab guard: git hash baked as `__BUILD_VERSION__` vs `welcome.v`; mismatch = one auto-reload. Dev caveat: after a commit, restart-or-touch the server AND rebuild `client/dist` or every join reloads once.
- NO drivable vehicles (user decision 2026-08-11). Powerup blocks removed (user decision). No natural HP regen (user decision).

**Physics gotchas (hard-won, don't rediscover):**

- Rapier kinematic controller: **always-on autostep stalls on open flat ground** — autostep re-runs only when the plain pass was blocked. The controller **refuses to slide along kinematic-body ground** — map ground must be FIXED bodies. Idle characters creep (penetration-recovery slides) — suppressed when desired movement ~zero.
- Raycasts see colliders only after a `world.step()`; a fresh Sim must step once. Colliders only exist near characters (streaming) — distant raycasts miss by design.
- Face transitions NEVER flip while rising relative to the current face (edge-jump return bug); camera view-up lerps with an ANTIPODAL tangent nudge + `snapUp` on spawns (else far-face spawns render upside down forever).
- Kenney characters carry named node-transform clips; the client strips the `root.position` track from walk/sprint (root motion fought the network position = run shake) and overrides `arm-right` rotation after `mixer.update()` for aim pitch.
- Wire yaw convention: forward = `(sin yaw, cos yaw)` in the FACE frame; D maps to `moveX = -1`; server muzzle math, camera, and joystick must stay consistent.
- Client pump: rAF + setInterval fallback (rAF throttles in background tabs — affects Playwright probes: pending input queues read artificially deep headless).
- `addStaticBox(half, x, y, z)` — half-extents FIRST; tsx scratch scripts don't typecheck until `npm run typecheck`, so a wrong call order silently builds garbage probes.

## Testing notes

- Physics tests run real Rapier in Node on floating platforms at (500, 50, 500) — but `Sim.create()` builds the PLANET: off-planet positions get face-gravity along the dominant axis, so probes must either stand on the real planet or account for it.
- `respawn.test.ts` boots a real `Game` on an ephemeral port; tests never enable bots.
- Playwright: join via DOM (`input.join-name` + DROP IN), drive aim with `__look`, fire via `?touch` mode's `.btn-fire` pointer events (works without pointer lock). Hold synthetic keys ≥150 ms so the 60 Hz pump samples them. Bot kill-rate baseline ~40-50 knockouts/min match-wide.
