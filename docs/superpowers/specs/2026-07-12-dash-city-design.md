# Dash City — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning

## Overview

Dash City is a multiplayer 3D car-combat arena game played in the browser. Players enter a name, pick a car, get assigned to one of four teams, and drive around a Kenney-asset city trying to knock out players from other teams. Knockouts score points on two live leaderboards (teams and individuals). The game runs endlessly — players drop in and out at any time.

The game must be playable on both PC (keyboard) and mobile (touch) from the same responsive client. It will eventually be hosted on the user's VPS; until then, everything runs locally via one dev command, and playing alone in one browser tab is the single-player test mode. There is no separate single-player build — local play uses the exact production code path.

## Stack

| Layer | Choice |
|---|---|
| Client rendering | Three.js, bundled with Vite, TypeScript |
| Server | Node.js + TypeScript, `ws` WebSockets |
| Physics | Rapier (`@dimforge/rapier3d-compat`) — same engine on server and client |
| Shared logic | `shared/` package consumed by both client and server |
| Tests | Vitest, targeting `shared/` pure logic |
| Assets | Kenney GLB models (car kit, city kits, graveyard, train, watercraft), CC0 |

### Repo layout

```
client/    Vite app: rendering, input, UI, interpolation, local prediction
server/    Node app: authoritative simulation, rooms/sessions, snapshot broadcast
shared/    Types, protocol messages, physics tuning constants, city map data,
           damage formula, scoring rules, team-assignment logic
```

- `npm run dev` (root): starts server (with tsx watch) + Vite dev server concurrently.
- `npm run build` (root): builds client to static files; production server serves them and the WebSocket on one port — single process on the VPS.
- `npm test` (root): runs Vitest.

## Architecture: server-authoritative physics

The server owns the truth. Full rigid-body physics (Rapier) with raycast-vehicle suspension per car runs on the server at a fixed 60 Hz.

- **Client → server:** input packets ~30/s: `{ seq, throttle, steer, brake, handbrake }`.
- **Server → clients:** world snapshots 20/s: per-car transform (position, quaternion), velocity, HP, plus event messages (knockout, respawn, join, leave, score change).
- **Remote cars:** rendered from an interpolation buffer ~100 ms behind server time — smooth regardless of packet jitter.
- **Local car (prediction):** the client also runs a Rapier world containing only the local car and static city colliders, simulating from local inputs immediately so controls feel instant. Server states are reconciled by softly blending position/rotation error over a few frames (no hard snapping unless error is large, e.g. after being rammed).
- Snapshots use compact JSON initially; the protocol lives in `shared/` so it can move to binary later without redesign.

### Server responsibilities

- Fixed-timestep Rapier world: static city colliders + one dynamic vehicle per connected player.
- Applies each player's most recent input each tick.
- Detects car-vs-car collision impacts, computes damage, tracks HP, credits knockouts, updates scores.
- Team assignment on join; respawn scheduling; spawn protection timing.
- Broadcasts snapshots and events; prunes disconnected players.

### Client responsibilities

- Loads city + car GLBs, builds the visual scene from the shared city map data.
- Join screen (name + car picker), HUD, leaderboards, kill feed, touch/keyboard input.
- Chase camera following the local car.
- Interpolation of remote cars, prediction + reconciliation of local car.

## The city

The city is **data-driven**: `shared/cityMap.ts` defines a tile grid (roads, buildings, props, rails, water) plus special markers (4 team spawn plazas, train path). The client instantiates GLB models per tile; the server generates matching colliders (boxes/trimeshes for buildings and props, flat ground, invisible arena walls at the map edge). One source of truth — visuals and collision can never drift apart.

Four themed quadrants around a central roundabout:

| Team | Color | Quadrant theme | Key assets |
|---|---|---|---|
| Crimson | red | Downtown — dense grid of high-rises | city-kit-commercial |
| Azure | blue | Harbor — warehouses, cranes, docked boats | city-kit-industrial, watercraft-pack |
| Emerald | green | Suburbs — houses, trees, cul-de-sacs | city-kit-suburban |
| Violet | purple | Old Town — church, crypts, cemetery park | graveyard-kit |

Connective tissue: road network from city-kit-roads (including a central roundabout linking all quadrants), at least one bridge/ramp, scattered physics props (cones, boxes from the car kit), and a **decorative** train that loops the city perimeter on train-kit tracks (animated on the client; on the server it is a moving kinematic collider so cars can't pass through it, but it deals no damage and scores nothing).

Each team spawn plaza is an open paved area in its quadrant with 4+ spawn slots (so simultaneous respawns don't overlap) and team-color flair.

## Gameplay rules

### Joining

1. Join screen: name input (1–16 chars, trimmed; default "Player" if empty) + car picker showing a rotating 3D preview of car-kit vehicles (a curated list of ~8–12 drivable models; stats are identical across cars in v1 — cosmetic choice only).
2. On join, the server assigns the player to the team with the fewest **human** members (random among ties; bots don't count toward balancing). Team choice is not player-selectable.
3. Player spawns at a free slot in their team plaza.

### Damage & knockouts

- Every car has **100 HP**.
- Only **car-vs-car** impacts deal damage. Walls, buildings, props, and the train deal none.
- **Same-team collisions deal no damage** (this also enforces "no points for knocking teammates or yourself" — such knockouts cannot happen).
- Damage is computed in `shared/damage.ts` from relative impact speed: below a bump threshold → 0 damage; above it, damage scales with impact speed, capped per hit. Both cars in an impact take damage (the faster/rammer dynamic emerges from physics, not special-casing).
- When HP reaches 0: the victim is knocked out (wreck visual + brief camera hold), and the opposing player who dealt the **final blow** gets **+1 individual point and +1 team point**.
- Victim respawns at their team plaza after **3 s**, with **2 s spawn protection** (no damage taken or dealt).
- **Regen:** after 6 s without taking damage, HP regenerates slowly until full.

### Scoring & leaderboards (endless arena)

- Team scores persist as long as the server process runs.
- Individual scores persist for the player's session; leaving the game removes them from the individual board (their past team points remain on the team score).
- HUD shows: local player HP bar, compact 4-row team scoreboard (always visible), kill feed (recent knockouts), and a toggleable top-10 individual leaderboard (Tab on PC, button on mobile).

### Bots

To keep the arena lively, the server always fields **5 bots per team** (20 total), spawned at server start and respawning like players.

- Bots are full participants: same physics vehicle, same HP/damage rules, they score individual and team points, appear in the kill feed and on both leaderboards, and are visually indistinguishable from humans apart from their behavior.
- Each bot gets a **random nametag** generated from adjective + noun word lists (e.g. "TurboBadger", "RustyComet"), unique per session, with a random car-kit model.
- **AI (deliberately simple):** bots navigate the road network via waypoints derived from the shared city map. Each bot alternates between *cruising* (following road waypoints) and *hunting* (steering toward a nearby enemy car to ram it when one comes within range). Stuck detection (no movement for a few seconds) triggers reverse-and-turn recovery.
- Bots run inside the server's normal simulation loop — they produce the same `{ throttle, steer, brake, handbrake }` inputs a client would send, so downstream code doesn't distinguish bots from humans.
- The bot count is a server config constant; no dynamic scaling with human player count in v1.

## Controls & responsive UI

- **PC:** WASD / arrow keys (throttle, steer, brake-reverse), Space = handbrake.
- **Mobile:** left half of screen = touch steering (virtual joystick or drag zone), right side = accelerate / brake / handbrake buttons; layout sized with viewport units and touched up via media queries. Detected by pointer capability, with a manual toggle.
- Single responsive HTML/CSS UI for join screen, HUD, and leaderboards — no separate mobile build.
- Renderer scales pixel ratio / draw distance down on weaker devices (basic heuristic; Kenney low-poly assets keep the base cost small).

## Error handling & robustness

- WebSocket disconnect → client shows a reconnect overlay and retries; the server removes the player after a grace period (~10 s), preserving nothing but team score contributions.
- Server validates all client input ranges (clamps throttle/steer to [-1,1]); clients never send positions.
- Cars that fall out of the world or tip upside-down for >3 s are auto-respawned (no points to anyone).
- Malformed messages are ignored and logged.

## Testing

- **Vitest** unit tests for `shared/`: damage formula (thresholds, caps, same-team zero), scoring attribution (final blow, no self/team points), team assignment (fewest-human-members rule), bot nametag generation (uniqueness), and city map integrity (spawn points exist, tiles reference known assets).
- Driving feel, netcode smoothness, and mobile layout are validated by manual playtesting locally (single tab = single-player; multiple tabs = local multiplayer).

## Out of scope (v1)

- Persistence across server restarts (accounts, databases)
- Rounds/matches, win screens
- Car stat differences, upgrades, power-ups
- Smarter bot AI (pathfinding around obstacles, difficulty levels, dynamic bot count)
- Voice/text chat
- Anti-cheat beyond server authority + input validation
