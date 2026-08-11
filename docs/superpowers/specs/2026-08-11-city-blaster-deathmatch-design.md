# Dash City v3 — On-Foot Blaster Deathmatch (city rebuild)

Date: 2026-08-11. Supersedes the car-combat gameplay of the v1/v2 specs; the
long-term goal is a battle-royale city — this phase builds the city foundation
plus endless free-for-all blaster deathmatch. BR round structure (lobby,
shrinking zone, last-standing) is a LATER phase on top of this.

## Summary

Cars are no longer drivable — they become parked street decoration. Players are
Kenney blocky characters walking/running/jumping through one dense mainland
city, shooting each other with Kenney blaster-kit weapons. Endless drop-in
session, HP/knockouts/respawns, personal leaderboard, free-for-all (teams
removed). The proven multiplayer core (60 Hz authoritative tick, 20 Hz
snapshots, rewind+replay prediction, accounts, asset/footprint pipeline,
mobile controls) is kept; the vehicle simulation is replaced by a character
controller.

## 1. Map — one dense mainland city

`shared/src/cityMap.ts` `buildCityMap()` is rewritten (same contract:
deterministic, drives BOTH client visuals and server colliders).

- Single rectangular landmass, ~24×24 tiles of 12 m (~290 m across).
- Districts: commercial downtown core (dense towers), suburban ring (houses,
  gardens), industrial harbor along ONE map edge (docks, cargo ship), plus
  parks/plazas as open combat spaces.
- Road network uses the existing neighbour-based tile classifier and the
  measured `BEND_ROT`/`TEE_ROT`/`END_ROT` tables; `ROAD_LANE_Y` sinking
  unchanged.
- No islands, no bridges. Sea borders only the harbor edge; walking into the
  sea triggers the existing hazard respawn (nearest clear road tile).
- Parked cars (car-kit models) are STATIC decor along streets with static
  colliders (they are cover now).
- Knockable dynamic props stay (hay bales, pumpkins, plus blaster-kit crates);
  every visible decor object still reacts — no drive-through (walk-through)
  ghost decor. `fitsTile()` building filtering and `probe-road-blockers`-style
  street-clearance checks still apply.

## 2. Character simulation (`shared/src/sim.ts`)

The Rapier `DynamicRayCastVehicleController` and every vehicle-specific layer
(wake-on-input, reverse half-lock, brake swap, pop/tumble clamps, idle-sleep
stack) are deleted. In their place:

- One Rapier **kinematic character controller** per player: capsule collider,
  gravity, jump, sprint multiplier, step-offset so curbs/sidewalks don't block,
  snap-to-ground on slopes.
- Movement is camera-relative: the client sends its camera yaw with each
  input; the server rotates the move vector by it and aims shots with
  yaw+pitch. Yaw/pitch are client-authoritative (clamped in protocol).
- Tuning constants (walk/sprint speed, jump velocity, gravity, capsule size)
  live in `shared/src/constants.ts` / a new `character.ts` — never inlined.
- The sim stays deterministic → the client prediction contract (rewind+replay,
  render-only correction offset, fixed-timestep render interpolation) is
  reused as-is.
- Dynamic props remain in the sim and in the client prediction mirror (pushed
  props must render from prediction, same as before).

## 3. Input protocol

`InputState` becomes:

```
{ seq, moveX, moveZ, yaw, aimPitch, jump, sprint, fire }
```

- `moveX/moveZ` ∈ [-1,1] (analog for mobile joystick), `yaw` wrapped to ±π,
  `aimPitch` clamped (~±1.2 rad), booleans for jump/sprint/fire.
- Same delivery contract as today: every 60 Hz tick, server queues and applies
  ONE PER TICK, acks applied seq, no drops on jitter, starve-rebuffer at 2.

## 4. Shooting & combat

- **Server-authoritative projectiles**: a fire input (respecting the weapon's
  cooldown) spawns a foam dart at the character's muzzle, velocity ~45 m/s
  along the aim direction, straight line, ~1 s lifetime. Each tick the server
  sweeps the dart's segment against characters (capsules) and the static
  world; first hit wins. World hit or timeout despawns it.
- **Damage**: flat per-weapon damage (`shared/src/damage.ts` reworked); the
  speed-based car formula is deleted. No self-damage from own darts.
- **Weapons**: spawn holding the basic blaster. Weapon pickups (stronger
  blasters, grenades) sit at fixed crate spawn points defined in the map;
  walking over one swaps/adds it; the point respawns on a timer. Grenades:
  thrown arc, timed explosion, radial damage with falloff (server-simulated).
- **Scoring**: HP, knockouts, respawns, personal leaderboard reuse
  `server/src/combat.ts` + `players.ts` with team logic removed. FFA: everyone
  damages everyone. Knockout respawn uses spread-out spawn points; sea/stuck
  respawn uses nearest-road, as today.
- **Client feel**: own muzzle flash + tracer render instantly on fire input;
  authoritative darts arrive in snapshots (transient entities). Hit marker on
  `damage` messages for your own hits.

## 5. Networking

- Message flow unchanged: `hello/welcome/join/leave/snapshot/knockout/
  respawn/damage/reject/unstuck`.
- Snapshots carry characters (p, q(yaw), v, hp, weapon, anim flags), dynamic
  props, darts, ship/train. Remote characters render through the ~100 ms
  interp buffer; own character through prediction.
- Accounts (`accounts.ts`, scrypt, `data/players.json`) unchanged except the
  stored car pick becomes a character-skin pick.

## 6. Client

- **Camera**: over-shoulder third person, pointer-lock mouse-look on desktop
  (drag fallback), swipe-look on mobile; crosshair overlay.
- **Controls**: WASD move, mouse aim, Space jump, Shift sprint, click fire;
  mobile keeps the joystick and gains fire + jump buttons.
- **Characters**: 18 blocky-character skins picked at the join screen; blaster
  model attached to the hand; procedural walk animation (the pack is rigged
  but ships no clips — swing limbs if the rig cooperates, else a light bob;
  polish later). Name labels on remotes only, depth-tested, as today.
- **HUD**: HP bar, current weapon, leaderboard button, 🆘 unstuck button
  (kept), kill feed via existing knockout messages.

## 7. Assets

- New packs `kenney_blocky-characters` and `kenney_blaster-kit` are copied
  into the repo root (git-ignored like the others) and wired into
  `npm run assets` and `scripts/measure-footprints.mjs`; footprints for new
  models are MEASURED, never guessed; per-pack scale factors added to
  `MODEL_SCALES`.

## 8. Deleted vs kept

Deleted: vehicle physics + all car-feel layers, drivable cars, teams/team
scores/underglow, car damage formula, driving probes (feel/steer/tbone/
brake-wall/reverse/wake), car-specific tests.
Kept: train (moving decor), ship (harbor decor), accounts, mobile control
shell, dev/prod tooling (`npm run dev`/`start`), interp/prediction stack,
hazard respawns, `?debug=1` overlay, `__predErr`/`__trace` telemetry.

## 9. Testing

- `sim.test.ts` rewritten: walk/sprint speeds, jump height, curb step-up,
  dart flight + capsule hit, no-hit past lifetime, pickup swap, grenade
  radius damage, prop push.
- Server tests: FFA damage (no team immunity), knockout scoring, weapon
  cooldown enforcement, pickup respawn timer.
- New feel probes: `scripts/probe-walk.mts` (movement smoothness, step-up,
  idle stillness), `scripts/probe-shoot.mts` (dart accuracy vs moving
  target, cooldowns). Run after any sim/map change, like the old battery.
- Live playtest: multiple tabs + `fake-client.mjs` reworked to walk & shoot.

## Out of scope (later phases)

BR rounds (lobby, shrinking zone, win condition), squads, vehicles-as-
gameplay, character animation polish, sound design, map interiors.
