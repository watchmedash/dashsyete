# Dash City v3 — City Blaster Deathmatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace car combat with an on-foot free-for-all blaster deathmatch in one dense mainland city, keeping the proven multiplayer core.

**Architecture:** Same three-package layout (`shared`/`server`/`client`, relative imports, no workspaces). `shared/src/sim.ts` swaps the Rapier vehicle for a kinematic character controller; `cityMap.ts` is rewritten as one mainland; server keeps 60 Hz tick + 20 Hz snapshots and gains dart projectiles + weapon pickups; client keeps rewind+replay prediction + interp and gains an over-shoulder aim camera.

**Tech Stack:** Three.js, Rapier (`@dimforge/rapier3d-compat`), ws, Vite, Vitest, tsx. Kenney packs: blocky-characters (18 skins), blaster-kit, existing city kits.

## Global Constraints

- Gameplay numbers live in `shared/src/constants.ts` / `shared/src/character.ts` / `shared/src/weapons.ts` — never inlined elsewhere.
- `buildCityMap()` stays deterministic and drives BOTH client visuals and server colliders.
- Footprints are MEASURED via `scripts/measure-footprints.mjs`, never guessed; models place by bbox CENTER.
- Netcode contract unchanged: client sends every 60 Hz input; server applies one per tick, acks applied seq; no drops on jitter; starve-rebuffer at 2; render-only correction offset (x/z + yaw, never y); fixed-timestep render interpolation.
- No bots. No teams (FFA). Endless session.
- After any sim/map change run the probe battery (`probe-walk`, `probe-shoot`, `probe-road-blockers`, `probe-idle-spawns` reworked).
- `npm run typecheck` and `npm test` green before every commit.

---

### Task 1: New asset packs in the pipeline

**Files:**
- Copy dirs: `kenney_blocky-characters/`, `kenney_blaster-kit/` (repo root, git-ignored)
- Modify: `scripts/copy-assets.mjs` (or equivalent target of `npm run assets`), `.gitignore`, `shared/src/constants.ts` (`MODEL_SCALES`), `shared/src/modelFootprints.ts` (generated)

**Interfaces:**
- Produces: `client/public/assets/kenney_blocky-characters/character-a..r.glb`, `client/public/assets/kenney_blaster-kit/*.glb`; `MODEL_FOOTPRINTS["kenney_blocky-characters/character-a"]` etc.; `MODEL_SCALES["kenney_blocky-characters"]`, `MODEL_SCALES["kenney_blaster-kit"]`.

- [ ] Copy the two packs from `C:\Users\User\Desktop\model\` into the repo root; add both to `.gitignore` alongside the other `kenney_*` entries if not covered by a glob.
- [ ] Wire both packs into the assets-copy script (GLB format dirs) and run `npm run assets`; verify GLBs land in `client/public/assets/`.
- [ ] Run `node scripts/measure-footprints.mjs` (extend its pack list) to append measured footprints for characters, blasters, crates, grenades, targets; pick `MODEL_SCALES` so a character stands ~1.8 m tall and a blaster is hand-sized (~0.5 m) — verify by printing scaled bbox heights.
- [ ] Commit: `feat: blocky-characters + blaster-kit assets in pipeline`

### Task 2: Protocol v3

**Files:**
- Modify: `shared/src/protocol.ts`
- Test: `shared/src/protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface InputState { seq: number; moveX: number; moveZ: number; yaw: number; aimPitch: number; jump: boolean; sprint: boolean; fire: boolean }
  interface CharSnap { id: string; p: V3; q: V4; v: V3; hp: number; weapon: string; grounded: boolean }
  interface DartSnap { id: string; p: V3; v: V3; owner: string }
  // snapshot: { t:"snapshot", time, lastSeq, chars: CharSnap[], darts: DartSnap[] }
  // pickup state rides `chars` as id "pickup-<n>" with weapon = available weapon id or "" when on cooldown
  ```
  `decodeClient` clamps: moveX/moveZ ∈ [-1,1], yaw wrapped ±π, aimPitch ∈ [-1.2, 1.2], booleans coerced. `hello` gains `skin` (was `car`).
- [ ] Write failing tests: clamping of each field, yaw wrap, hello skin passthrough, unstuck unchanged.
- [ ] Run `npx vitest run shared/src/protocol.test.ts` — expect FAIL.
- [ ] Implement; run tests to PASS; `npm run typecheck` will break in dependents — acceptable until Tasks 3–10 land (keep on a feature branch, commit per task).
- [ ] Commit: `feat: v3 wire protocol - character inputs, dart snapshots, skins`

### Task 3: Character controller sim

**Files:**
- Create: `shared/src/character.ts` (tuning)
- Modify: `shared/src/sim.ts` (delete vehicle layers; add character API), `shared/src/constants.ts`
- Test: `shared/src/sim.test.ts` (rewrite)

**Interfaces:**
- Produces (in `character.ts`):
  ```ts
  export const CHAR_RADIUS = 0.35, CHAR_HALF_HEIGHT = 0.55; // capsule ⇒ ~1.8 m tall
  export const WALK_SPEED = 5, SPRINT_SPEED = 8, ACCEL = 40;
  export const JUMP_VEL = 8, GRAVITY = 25, STEP_OFFSET = 0.45, MAX_SLOPE = 0.9; // rad
  export const AIR_CONTROL = 0.3;
  ```
- Produces (Sim): `addChar(id, x, z, yaw)`, `removeChar(id)`, `setInput(id, InputState)`, `step()`, `getState(id) → {p,q,v,grounded}`, `setState(id, p, q, v)` (q carries yaw only), prop APIs unchanged. Movement: input `moveX/moveZ` rotated by input `yaw`, accelerate toward target velocity (ACCEL, ×AIR_CONTROL airborne), vertical velocity integrated manually (−GRAVITY·dt, JUMP_VEL on grounded jump), `KinematicCharacterController.computeColliderMovement` with autostep + snap-to-ground, then `setNextKinematicTranslation`.
- [ ] Delete vehicle code paths (controller, wake/brake/reverse/tumble/sleep layers) and `addCar`; keep props, map colliders, ship/train bodies.
- [ ] Write failing tests: walk reaches ~WALK_SPEED on flat ground within 1 s; sprint reaches ~SPRINT_SPEED; jump apex height ≈ JUMP_VEL²/(2·GRAVITY) ± 15 %; walking at a curb (0.2 m step) climbs it; idle character on flat ground moves < 1 mm over 120 ticks; determinism: two sims fed identical inputs land bit-identical positions after 300 ticks.
- [ ] Run tests → FAIL → implement → PASS.
- [ ] Commit: `feat: kinematic character controller replaces vehicle sim`

### Task 4: Weapons + flat damage

**Files:**
- Create: `shared/src/weapons.ts`
- Modify: `shared/src/damage.ts` (replace speed formula)
- Test: `shared/src/weapons.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Weapon { id: string; model: string; damage: number; cooldownTicks: number; dartSpeed: number; auto: boolean }
  export const WEAPONS: Record<string, Weapon> = {
    blaster:  { id:"blaster",  model:"blaster-a", damage:10, cooldownTicks:21, dartSpeed:45, auto:false },
    rapid:    { id:"rapid",    model:"blaster-f", damage:6,  cooldownTicks:7,  dartSpeed:50, auto:true  },
    heavy:    { id:"heavy",    model:"blaster-r", damage:25, cooldownTicks:54, dartSpeed:40, auto:false },
  };
  export const GRENADE = { fuseTicks:90, radius:6, maxDamage:60, throwSpeed:14, throwUp:6 };
  export const DEFAULT_WEAPON = "blaster";
  export function grenadeDamage(dist: number): number; // linear falloff to 0 at radius
  ```
- [ ] Failing tests: cooldowns positive, grenadeDamage(0)=60, grenadeDamage(6)=0, monotonic falloff.
- [ ] Implement → PASS → Commit: `feat: weapon table + flat damage model`

### Task 5: Dart + grenade projectile simulation

**Files:**
- Create: `shared/src/projectiles.ts`
- Test: `shared/src/projectiles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Dart { id: string; owner: string; weapon: string; p: V3; v: V3; ticksLeft: number }
  export interface Nade { id: string; owner: string; p: V3; v: V3; fuse: number }
  // step darts against a Sim: segment sweep p → p+v·dt; returns hits
  export function stepDarts(sim: Sim, darts: Dart[], charIds: string[]): { dart: Dart; hitChar: string | null }[]
  export function stepNades(sim: Sim, nades: Nade[]): { nade: Nade; exploded: boolean }[]
  ```
  Dart-vs-character = segment vs capsule (analytic, uses CHAR_RADIUS/CHAR_HALF_HEIGHT and sim char positions, owner excluded); dart-vs-world = Rapier ray cast on the sim world with max distance = segment length. Nades: ballistic integrate (GRAVITY), bounce via ray cast with restitution 0.4, explode at fuse 0.
- [ ] Failing tests: dart fired at a standing character 10 m ahead hits within expected ticks; dart misses a character 2 m off axis; dart stops at a building wall (use a map building coordinate); dart expires after lifetime; owner immune to own dart at spawn overlap; nade explodes at fuse and grenadeDamage applies by distance.
- [ ] Implement → PASS → Commit: `feat: server-authoritative darts + grenades`

### Task 6: Mainland city map

**Files:**
- Modify: `shared/src/cityMap.ts` (rewrite `buildCityMap()` internals; keep exported shape: tiles, buildings, decor, props, grounds, spawns, crateSpawns NEW)
- Test: `shared/src/cityMap.test.ts`

**Interfaces:**
- Produces: `map.spawns: {x,z,yaw}[]` ≥ 16 FFA spawn points on clear road/plaza tiles spread ≥ 30 m apart; `map.crateSpawns: {x,z,weapon}[]` ~12 pickup points; `map.parkedCars: {pack,model,x,z,rotY}[]` static decor (client renders, sim adds static colliders); grounds = one mainland slab + harbor water edge on north side only.
- Layout (deterministic, hand-tuned constants): 24×24 tile grid; ring road at radius ~9 tiles; downtown 8×8 commercial core with 2×2 block grid; suburban ring outside it; industrial strip along north edge with docks + ship; 2 park plazas and 1 central plaza; graveyard corner kept as flavor.
- [ ] Failing tests: determinism (two builds identical JSON); every road tile reachable from every other (flood fill over road adjacency); all spawns on clear tiles ≥ 30 m apart; no building footprint intrudes on a road tile (`fitsTile` still enforced); crateSpawns on walkable tiles.
- [ ] Implement; run `npx tsx scripts/probe-road-blockers.mts` → zero intrusions.
- [ ] Commit: `feat: dense mainland city map`

### Task 7: Server rework — FFA characters, combat, pickups

**Files:**
- Modify: `server/src/game.ts`, `server/src/combat.ts`, `server/src/players.ts` (drop teams), `server/src/accounts.ts` (skin field)
- Test: `server/src/combat.test.ts`, `server/src/game.test.ts`

**Interfaces:**
- Consumes: Sim char API (Task 3), WEAPONS/GRENADE (4), stepDarts/stepNades (5), map.spawns/crateSpawns (6), protocol v3 (2).
- Produces: 60 Hz tick = drain one input per char (same starve-rebuffer queue) → sim.step → spawn darts for `fire` edges/auto (per-weapon cooldown, server-enforced) → stepDarts/stepNades → apply damage → knockouts (attacker +1 score, victim respawn timer at random far spawn) → 20 Hz snapshot `{chars, darts}`. Pickups: char within 1.2 m of an armed crateSpawn swaps weapon; crate rearms after 15 s. Sea/void → hazardRespawn (kept); unstuck kept.
- [ ] Failing tests: dart hit applies weapon damage; hp 0 → knockout + score + respawn with full HP and DEFAULT_WEAPON; no self-damage; pickup swap + rearm timer; fire ignored during cooldown; scores survive leave/rejoin (accounts).
- [ ] Implement; delete team logic everywhere (`players.ts` teamScores, spawn slots by team).
- [ ] Commit: `feat: FFA blaster combat server`

### Task 8: Client input, camera, prediction

**Files:**
- Modify: `client/src/input.ts`, `client/src/touch.ts`, `client/src/look.ts`, `client/src/camera.ts`, `client/src/prediction.ts`, `client/src/net.ts`, `client/src/main.ts` (pump wiring)
- Test: `client/src/joystick.test.ts` (rework mapping)

**Interfaces:**
- Consumes: Sim char API, protocol v3.
- Produces: pointer-lock mouse-look sets `yaw/aimPitch`; WASD → moveX/moveZ; Space jump, Shift sprint, mouse-down fire. Camera: over-shoulder — position = char + `R(yaw)·(0.6, 1.6, -3.2)`, lookAt = char + `R(yaw,pitch)·(0.6, 1.4, 10)`; no lag on yaw (aim must be 1:1), small position smoothing on translation only. Prediction: same class, char instead of car; correction offset + interpolation code untouched; fire is NOT predicted beyond local tracer VFX.
- [ ] Rework `LocalPrediction` to `addChar`; keep `off`/`offYaw`/`prevP` machinery byte-for-byte.
- [ ] Mobile: left joystick → moveX/moveZ; right-half swipe → yaw/pitch; fire button (right-bottom), jump button above it.
- [ ] Verify with Playwright: walk a straight road at sprint, `?debug=1` overlay sd < 1, zero big corrections on loopback.
- [ ] Commit: `feat: on-foot input, aim camera, character prediction`

### Task 9: Client rendering — characters, blasters, city dressing

**Files:**
- Modify: `client/src/cars.ts` → rename `client/src/chars.ts` (skins, name labels), `client/src/city.ts` (parked cars, crates), `client/src/assets.ts`, `client/src/interp.ts` (chars+darts), `client/src/main.ts`
- Create: `client/src/darts.ts` (dart/tracer/muzzle-flash pool)

**Interfaces:**
- Consumes: snapshots (7), prediction pose (8), assets (1).
- Produces: remote chars from interp buffer, own char from prediction (hidden head-bob free); blaster GLB parented to right-hand offset `(0.25, 0.9, 0.15)` local; procedural anim: legs/arms swing ∝ ground speed (rig bones if present, else whole-model bob ±0.03 m + 4° lean into acceleration); darts rendered as `bullet-foam` GLB oriented along v, own-fire tracer spawned instantly on click; muzzle flash sprite 80 ms. Parked cars + crates placed from map. Name labels depth-tested, remotes only.
- [ ] Implement; screenshot check via Playwright (join, see own hands/blaster, remote walker, parked cars).
- [ ] Commit: `feat: character + blaster rendering, city dressing`

### Task 10: HUD, join screen, mobile chrome

**Files:**
- Modify: `client/src/ui/join.ts` (skin picker grid of 18), `client/src/ui/hud.ts` (HP bar, weapon name/icon, crosshair, kill feed), `client/src/ui/leaderboard.ts` (personal only), `client/src/ui/style.css`

- [ ] Skin picker: 3×6 grid of character thumbnails (render-to-texture or static names), stored in account like car was.
- [ ] HUD: crosshair center dot + ring; HP bar bottom-left; weapon chip bottom-right; kill feed top-right (last 4, fade 5 s); leaderboard + 🆘 unchanged.
- [ ] Remove team UI everywhere (team leaderboard tab, team colors).
- [ ] Commit: `feat: v3 HUD + skin picker`

### Task 11: Cleanup, probes, docs

**Files:**
- Delete: driving probes (`probe-feel/steer/tbone/brake-wall/reverse/wake/idle-spawns/spawns` — keep any generic helpers), car-only code.
- Create: `scripts/probe-walk.mts`, `scripts/probe-shoot.mts`
- Modify: `scripts/fake-client.mjs` (walk a patrol loop + fire at nearest), `scripts/spectate.mjs`, `CLAUDE.md` (rewrite gameplay/physics sections for v3), memory files.

- [ ] `probe-walk`: spawn at each map.spawn, walk 10 s straight + a curb crossing; report max tick-to-tick jump, step-up success, idle drift (must be ~0).
- [ ] `probe-shoot`: stationary + strafing target at 10/25/40 m; report hit rates and dart flight times.
- [ ] `npm test` + `npm run typecheck` fully green; delete dead exports.
- [ ] Rewrite CLAUDE.md sections (project summary, invariants, gotchas that survive, new probes).
- [ ] Commit: `chore: v3 cleanup, probes, docs`

### Task 12: AAA polish loop (repeat until perfect)

Iterate — each pass: pick the worst thing, fix, verify with probes/Playwright screenshots, commit.

- [ ] Lighting/atmosphere: hemisphere + directional sun with tuned shadows, sky gradient + distance fog matched to sea color, night-neutral palette.
- [ ] Feel: acceleration curves, camera collision (raycast pullback so walls never occlude), landing dip, sprint FOV +5°, hit-stop 40 ms on knockout.
- [ ] VFX: dart impact puff (`smoke.glb`/sprite), grenade shockwave ring, pickup bob+spin, respawn shield shimmer.
- [ ] Audio: interface-sounds pack for UI; simple blaster/hit/knockout SFX (existing pack or synth), positional.
- [ ] Performance: instanced city meshes where needed, 60 fps on the dev machine at 1080p (`?debug=1` slowFrames 0).
- [ ] Playtest with 2 tabs + reworked fake-clients; fix every visible glitch (prop lag, label flicker, seam bumps).

---

## Self-review notes

- Spec coverage: §1→Task 6, §2→3, §3→2, §4→4+5+7, §5→7, §6→8+9+10, §7→1, §8→11, §9→3–7 tests + 11 probes; AAA bar→12.
- Types consistent: `InputState`/`CharSnap`/`DartSnap` defined once in Task 2 and consumed by 3/5/7/8; character constants defined in Task 3 and consumed by 5/8.
- Ordering: Tasks 2–6 break typecheck transiently; work on branch `v3-blaster`, merge to master when Task 11 is green.
