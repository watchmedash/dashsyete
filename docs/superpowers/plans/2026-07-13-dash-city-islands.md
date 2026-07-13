# Dash City Map v2 (Islands) + Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-landmass map with a 5-island archipelago (4 themed team islands + downtown free-for-all center, 8 bridges, living sea) and fix labels, HP bar, flipping/side-stuck cars, sunken car visuals, road connectivity, and drive-through buildings.

**Architecture:** Everything flows from `shared/src/cityMap.ts` v2: it gains `grounds` (island slabs), `waterY`, `waypointRoutes` (per-team bot routes), `shipPath`, and `props` (dynamic prop spawns). Colliders are generated from a measured `MODEL_FOOTPRINTS` table instead of tile-size guesses. Server: ground cuboids per island, dynamic props, kinematic ship (train retired). Client: island ground meshes + water plane, prop/ship visuals, outlined team-color labels, thinner HP bar, anchored car models. Physics: lower CoM, speed-sensitive steering, side-flip detection.

**Tech Stack:** unchanged (Three.js, Rapier compat, ws, Vitest, tsx/Vite).

**Spec:** `docs/superpowers/specs/2026-07-13-dash-city-islands-design.md`. Read `CLAUDE.md` "Physics gotchas" before touching sim code.

## Global Constraints

- Grid 48×48, `TILE` stays 12 (world span ±288 m). Water plane at y = −2 (visual only). `KILL_FLOOR_Y` becomes −6.
- Islands: center 16×16 tiles (Downtown, no spawns); team islands 12×12 at N (Crimson uptown), E (Azure harbor), S (Emerald suburbs), W (Violet old town). Team ids stay 0..3 in that order.
- 8 bridges: 4 straight spokes (island→center), 4 ring links bending on small corner islets.
- Same-team no damage, water/flip respawns give no points, all other v1 rules unchanged.
- All gameplay numbers stay in `shared/src/constants.ts`; all geometry in `shared/src/cityMap.ts` (drives BOTH client visuals and server colliders).
- Every task ends with `npm run typecheck` + `npm test` green before committing.
- Playwright note: the browser window is occluded — rAF runs ~1 fps there, timers throttle; game logic already runs on timers and catches up. Screenshots work fine.

---

### Task 1: Client quick fixes — labels, HP bar, car anchoring

**Files:**
- Modify: `client/src/cars.ts` (label style, remove ring, model Y-offset), `client/src/ui/style.css` (`.hp-wrap` height)

**Interfaces:**
- Consumes: `TEAMS` colors, `WHEEL_REST`/`WHEEL_RADIUS`/`CHASSIS_HALF` from `shared/src/vehicle.ts`.
- Produces: no API changes — visual only.

- [ ] **Step 1: Label rewrite** in `makeLabel`: transparent canvas, no rounded rect; `ctx.font = "bold 44px system-ui"`, `ctx.lineWidth = 8; ctx.strokeStyle = "rgba(10,12,18,0.9)"; ctx.strokeText(name, 128, 34, 240);` then `ctx.fillStyle = teamColor; ctx.fillText(...)`. Sprite scale ≈ `(4.0, 1.0, 1)`.
- [ ] **Step 2: Remove the underglow ring** (delete the RingGeometry block in `ensure`).
- [ ] **Step 3: Anchor car models.** In `ensure`, after scaling, compute the scaled bounding box and place the model so its bottom sits at the chassis' ground-contact plane:

```ts
const box = new THREE.Box3().setFromObject(model);
// chassis center (the root) sits at WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y
// above the road; the visual's wheels must touch the road.
model.position.y = -(WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y) - box.min.y;
```

- [ ] **Step 4: HP bar** in `style.css`: `.hp-wrap` height 18px → 8px, border-radius 5px.
- [ ] **Step 5: Verify visually** — `npm run dev`, join, screenshot: outlined team-color name floating (no pill, no ring), wheels on the road (not buried), thin HP bar. Check a remote car too (fake-client).
- [ ] **Step 6: Commit** — `git commit -m "fix: outlined team labels, thinner hp bar, anchored car models"`

### Task 2: Anti-flip physics (TDD)

**Files:**
- Modify: `shared/src/vehicle.ts`, `shared/src/sim.ts`
- Test: `shared/src/sim.test.ts`

**Interfaces:**
- Produces: `Sim.isFlipped(id)` now true when up-vector y < 0.3 (side-resting). New constants `COM_DROP = 0.35` (m below chassis center), `STEER_SPEED_FALLOFF = 18` (m/s where steering is ~halved).

- [ ] **Step 1: Failing tests** (append to `sim.test.ts`):

```ts
it("detects a car resting on its side as flipped", () => {
  const car = sim.addCar("side", 30, -30, 0);
  // roll ~90°: quaternion for rotation about z axis
  car.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
  for (let i = 0; i < 30; i++) sim.step();
  expect(sim.isFlipped("side")).toBe(true);
  sim.removeCar("side");
});

it("hard cornering at top speed does not flip the car", () => {
  sim.addCar("corner", -60, -30, 0);
  sim.setInput("corner", { seq: 1, throttle: 1, steer: 0, brake: 0, handbrake: false });
  for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // reach speed
  sim.setInput("corner", { seq: 2, throttle: 1, steer: 1, brake: 0, handbrake: false });
  for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // full-lock at speed
  expect(sim.isFlipped("corner")).toBe(false);
  sim.removeCar("corner");
});
```

- [ ] **Step 2: Run, verify the cornering test fails** (or flips) with current tuning: `npx vitest run shared/src/sim.test.ts`.
- [ ] **Step 3: Implement.** `vehicle.ts`: add `COM_DROP = 0.35`, `STEER_SPEED_FALLOFF = 18`. `sim.ts` `addCar`: after creating the collider, lower the CoM:

```ts
body.setAdditionalMassProperties(
  0,                       // no extra mass
  { x: 0, y: -COM_DROP, z: 0 },  // shift CoM down
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0, w: 1 },
  true,
);
```

(If `setAdditionalMassProperties` with 0 mass has no effect in this Rapier version, instead use a second dense thin collider at the chassis floor: `ColliderDesc.cuboid(CHASSIS_HALF.x, 0.1, CHASSIS_HALF.z).setTranslation(0, -CHASSIS_HALF.y, 0).setMass(CHASSIS_MASS * 0.6)` and reduce the main collider's mass to `CHASSIS_MASS * 0.4` — verify with the cornering test either way.)
`step()`: speed-sensitive steering: `const lock = MAX_STEER / (1 + speed / STEER_SPEED_FALLOFF); controller.setWheelSteering(0, input.steer * lock)` (and wheel 1). `isFlipped`: `return upY < 0.3;`
- [ ] **Step 4: Run tests** → all green (older steering-feel tests may need tuning tolerance, adjust constants not assertions where behavior is the spec).
- [ ] **Step 5: Manual feel check** — dev server, drive: sharp turns at speed grip instead of rolling; handbrake still slides. Tune `COM_DROP`/`STEER_SPEED_FALLOFF` by feel.
- [ ] **Step 6: Commit** — `git commit -m "fix: anti-flip physics and side-stuck detection"`

### Task 3: Measured model footprints

**Files:**
- Create: `shared/src/modelFootprints.ts`, `scripts/measure-footprints.mjs` (documentation of how the table was produced)
- Test: `shared/src/modelFootprints.test.ts`

**Interfaces:**
- Produces: `MODEL_FOOTPRINTS: Record<string, Footprint>` where `Footprint = { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number }` — bounding-box **center offset** and **half extents** in native (unscaled) units, key `"pack/model"`. Helper `footprintCollider(pack: string, model: string, scale: number, x: number, z: number, rot: Rot): BoxCollider` in `cityMap.ts` (Task 4) uses it: world center = tile pos + rotated scaled (cx, cz); half extents swapped when rot is odd.

- [ ] **Step 1: Measure.** With `npm run dev` up, run this in the Playwright browser (evaluate on http://localhost:5174) for EVERY model the map will use (full lists in Task 5/6 — measure the union; ~120 models):

```js
async () => {
  const { loadModel } = await import('/src/assets.ts');
  const THREE = await import('/@id/three');
  const models = { commercial: ['building-a', /* ... */], /* pack: [models] */ };
  const out = {};
  for (const [pack, list] of Object.entries(models))
    for (const m of list) {
      const obj = await loadModel(pack, m);
      const b = new THREE.Box3().setFromObject(obj);
      out[`${pack}/${m}`] = {
        cx: +((b.min.x + b.max.x) / 2).toFixed(3), cy: +((b.min.y + b.max.y) / 2).toFixed(3),
        cz: +((b.min.z + b.max.z) / 2).toFixed(3),
        hx: +((b.max.x - b.min.x) / 2).toFixed(3), hy: +((b.max.y - b.min.y) / 2).toFixed(3),
        hz: +((b.max.z - b.min.z) / 2).toFixed(3),
      };
    }
  return JSON.stringify(out);
}
```

Paste the result into `shared/src/modelFootprints.ts` as a typed constant. Save the measuring snippet into `scripts/measure-footprints.mjs` with a comment explaining how to re-run it.
- [ ] **Step 2: Sanity tests** — `modelFootprints.test.ts`: every entry has positive half extents; a couple of spot checks (`roads/road-straight` hx≈0.5, `graveyard/gravestone-cross` hx < 0.3).
- [ ] **Step 3: Run tests** → green. **Commit** — `git commit -m "feat: measured model footprint table"`

### Task 4: City map v2 skeleton — islands, water, bridges, spawns (TDD)

**Files:**
- Modify: `shared/src/cityMap.ts` (rewrite generator), `shared/src/cityMap.test.ts` (rewrite), `shared/src/constants.ts` (`KILL_FLOOR_Y = -6`, add `WATER_Y = -2`), `shared/src/sim.ts` (grounds instead of map-wide slab)
- Test: `shared/src/cityMap.test.ts`, `shared/src/sim.test.ts` (offshore-fall test)

**Interfaces (produced, consumed by every later task):**

```ts
export interface GroundRect { x0: number; z0: number; x1: number; z1: number; }   // world coords, top at y=0
export interface PropSpawn { pack: string; model: string; x: number; z: number; }
export interface CityMap {
  size: number;                                  // 48
  tiles: Tile[];
  colliders: BoxCollider[];
  grounds: GroundRect[];                         // island + islet + bridge-deck slabs
  waterY: number;                                // -2
  spawns: { team: TeamId; points: SpawnPoint[] }[];
  waypointRoutes: { x: number; z: number }[][];  // index = team id; each an ordered closed route
  shipPath: { x: number; z: number }[];          // open-sea loop around everything
  props: PropSpawn[];                            // dynamic prop spawn list
}
```

Layout constants inside the generator (tile indices, `SIZE = 48`):
- Center island rect tiles `[16,16)–[32,32)`; roundabout reserved 3×3 at tiles 23–25.
- North island tiles x `[18,30)`, z `[1,13)`. East/South/West generated from the north layout by rotating quarter-turns around the map center: `rotTile(gx, gz, q)` → q=1: `(SIZE-1-gz, gx)`; tile `rot` field += q (mod 4). Build ALL north-island content (roads, plaza, spawns, dressing hooks) once in a local buffer, then stamp 4 rotated copies with per-island themes selected by quadrant index.
- Spoke bridge: single column tiles gx 23 and 24 (2 lanes side by side), gz `[13,16)` (3 tiles of `road-bridge`), plus matching `grounds` strip and low side-rail colliders (hy 0.6, thickness 0.3) along both outer edges.
- Ring link N→E: bridge east from north island edge (gx 30, gz 6–7) to a 4×4 corner islet at tiles `[34,38)×[4,8)` with `road-bend`, then south to the east island. Other three links come from the same rotation stamping.
- `grounds`: center rect, 4 island rects, 4 islet rects, 12 bridge deck strips. Ground slab thickness 2 (cuboid half-height 1, top at 0). No arena walls.
- Spawns: 6 per team on their plaza (reuse v1 slot pattern), `rotY` facing the island's spoke bridge.
- `waypointRoutes[team]`: ordered points — plaza-side island loop → spoke bridge → center ring road (rect tiles 18–29 on center island roads) → back over the spoke. All points on road/bridge tiles.
- `shipPath`: rectangle loop at world ±258 (outside everything).
- `buildCityMap()` stays deterministic and pure.

- [ ] **Step 1: Rewrite `cityMap.test.ts`** (failing first). Keep v1-style checks, updated:

```ts
// - spawns: 4 teams × ≥6 points, each point inside its own island ground rect
// - every waypointRoutes[t] point lies inside SOME ground rect (island/islet/bridge deck)
// - waypointRoutes.length === 4, each ≥ 12 points
// - grounds.length ≥ 9 (center + 4 islands + 4 islets) and none overlap the center of another team's spawn
// - shipPath ≥ 4 points, all OUTSIDE every ground rect
// - props ≥ 20, every prop inside some ground rect
// - tiles reference known packs; deterministic (deep-equal twice)
const onGround = (p: {x: number; z: number}) =>
  map.grounds.some(g => p.x >= g.x0 && p.x <= g.x1 && p.z >= g.z0 && p.z <= g.z1);
```

Write each as a real `it()` block.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the generator skeleton**: grounds, water constant, plazas/spawns, road grids (island: plaza ring + 2 cross streets; center: ring road rect tiles 18–29 + avenues to the 4 spoke mouths + roundabout), bridges + islets + rails, waypoint routes, ship path, empty-ish props list (a few cones — Task 6 fills it), building dressing minimal (Task 6 fills). Use `footprintCollider` (write it here) for everything placed.
- [ ] **Step 4: Update `sim.ts`**: replace the single ground slab with one fixed cuboid per `map.grounds` rect (`half = {x:(x1-x0)/2, y:1, z:(z1-z0)/2}`, center y = −1). Add offshore test to `sim.test.ts`:

```ts
it("a car driven off an island falls into the sea", () => {
  sim.addCar("wet", 6, -30, Math.PI); // on center island facing north spoke... use a shoreline spot
  // place directly at a shoreline with velocity toward water instead:
  sim.setState("wet", [90, 1.2, 90], [0, 0, 0, 1], [20, 0, 20]); // SE corner of center island, moving offshore
  for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
  expect(sim.getState("wet").p[1]).toBeLessThan(-2);
  sim.removeCar("wet");
});
```

- [ ] **Step 5: Update dependents to compile**: `server/src/game.ts` (kill floor unchanged logic; spawn/respawn fine), `server/src/bots.ts` (`waypointLoops` → `waypointRoutes[team]` — bots use their team's route; remove the loop-index/dir logic if it fights routes, keep dir ±1), delete `server/src/train.ts` usage from `game.ts` (full ship replacement lands in Task 8; a compile-clean stub is fine: remove train imports/calls now). Client `city.ts`: ground meshes per rect (color: center `#5b5f66` asphalt, islands `#6f7f52` grass-ish, islets/bridge decks asphalt) + water plane `#2e6fa3` size 4×span at `waterY`.
- [ ] **Step 6: Run everything** — `npm test`, `npm run typecheck` → green.
- [ ] **Step 7: Visual check** — dev server, browser: fly-over screenshot (temporarily raise chase cam or use the join-screen preview trick — simplest: join and screenshot from spawn, then screenshot the overview by adding `?cam=high` handling is NOT needed; judge from spawn + drive). Confirm: islands separated by water, bridges span gaps, no floating tiles.
- [ ] **Step 8: Commit** — `git commit -m "feat: island archipelago map skeleton with bridges, water, routes"`

### Task 5: Roads done right — junction rotations verified

**Files:**
- Modify: `shared/src/cityMap.ts` (road placement details)

Road pieces (all from `roads` pack): `road-straight` (rot 0 = runs along z, verified v1), `road-bend`, `road-intersection` (T), `road-crossroad` (4-way), `road-roundabout` (3×3), `road-bridge`, `road-end-round` (dead ends), `road-crossing` (crosswalk straight, sprinkle near plazas).

- [ ] **Step 1: Determine bend/T/bridge orientations empirically.** Add a temporary debug row in the generator (behind `const DEBUG_ROADS = false` flag): at a known empty spot place `road-bend` rot 0–3 in a row, `road-intersection` rot 0–3, `road-bridge` rot 0/1. Flip the flag, screenshot from above at street level (drive there or move spawn), note which rot connects which directions, write the mapping as a comment table in the generator:

```ts
// road-bend rot table (measured): rot 0 connects -z & +x, rot 1 connects ...
// road-intersection rot table (measured): rot 0 stem faces ...
```

- [ ] **Step 2: Fix all junctions** in island grids, center ring, bridge mouths, and islet bends using the measured tables. Dead-end stubs get `road-end-round`.
- [ ] **Step 3: Verify by driving the whole network** — drive every bridge, the center ring, one island loop; screenshot each junction type at street level: lanes/sidewalks continuous, no seams/gaps/foreign rotations. Fix and re-check until clean. Delete the debug row.
- [ ] **Step 4: Tests still green; commit** — `git commit -m "feat: verified road junction rotations across islands"`

### Task 6: Island dressing + measured colliders + props list

**Files:**
- Modify: `shared/src/cityMap.ts` (theme functions), `shared/src/modelFootprints.ts` (add any newly used models — re-run the Task 3 measurement)

Theme content (all placed via `footprintCollider`; pure-visual small items get NO collider):

- **Center/Downtown:** skyscrapers `building-skyscraper-a..e` around the ring; street lights `light-square-double` along avenues (slim colliders 0.2×0.2); construction zone: `construction-barrier`×6, `construction-cone`×8, `construction-light`×2 near the roundabout (visual only — the dynamic cones are separate); 4 ramps: `tile-slant` pairs (up+down) placed on the ring road straights facing each other so cars can jump; `detail-parasol-a/b` on plaza corners.
- **Crimson/Uptown (north):** `building-a..h` low-rises with `detail-awning`/`detail-overhang` fronts (visual), `planter` rows (low collider), lights.
- **Azure/Harbor (east):** `building-d/h/i/j/k/n/o` warehouses, `chimney-large`, `detail-tank`; freight yard: 2 parallel `track` runs with parked `train-carriage-box/coal/container-red/tank` (colliders); dock edge: `cargo-container-a/b/c` stacks + `cargo-pile-a/b` (colliders); offshore (on water, no ground/collider): `boat-tug-a`, `boat-fishing-small`, `boat-speed-b`, `buoy`/`buoy-flag` marking bridge channels.
- **Emerald/Suburbs (south):** `building-type-*` (measured 1-tile subset), `driveway-short`, `path-stones-short` (visual), `fence`/`fence-low` yard borders (low colliders), `tree-large/small`, `planter`, `hay-bale` clusters (visual duplicates of the dynamic ones).
- **Violet/Old Town (west):** `crypt*` lanes, gravestone rows (visual), `pine`s, `iron-fence-border`+`iron-fence-border-gate` island perimeter accents (low colliders), `lightpost-double`, `altar-stone`+`coffin` corner, pumpkin patch (`pumpkin`, `pumpkin-tall`, visual), ghost ship `ship-small-ghost` offshore on the water.
- **Map corners (sea):** `ship-large` anchored near one corner, `boat-sail-a/b` near others, buoys.
- **`props` list (~24 dynamic):** cones ×8 (center construction + uptown), `box` ×6 (harbor), `hay-bale` ×5 (suburbs), `pumpkin` ×5 (old town) — exact x/z on open road/plaza spots.

- [ ] **Step 1: Measure new models** (Task 3 snippet), extend `MODEL_FOOTPRINTS`.
- [ ] **Step 2: Implement theme functions** (`dressCenter`, `dressUptown`, `dressHarbor`, `dressSuburbs`, `dressOldTown`, `dressSea`) — each takes the tile buffer + collider list; keep each under ~60 lines by using small placement helpers (`row`, `scatter` with deterministic modulo patterns).
- [ ] **Step 3: Tests green** (props ≥ 20 test now passes for real; spawn-clearance test must still pass — dressing may not encroach on plazas).
- [ ] **Step 4: Visual pass** — screenshots of each island from its plaza and one street; confirm: nothing floats, nothing blocks bridge mouths or spawn plazas, drive into a building = solid at its visible face (test the previously drive-through suburbs specifically), ramps are drivable jumps.
- [ ] **Step 5: Commit** — `git commit -m "feat: dense island theming with measured colliders"`

### Task 7: Dynamic props (server + client)

**Files:**
- Modify: `shared/src/sim.ts` (dynamic prop bodies), `server/src/game.ts` (spawn + snapshot), `client/src/main.ts` + `client/src/cars.ts` (render props)
- Test: `shared/src/sim.test.ts`

**Interfaces:**
- `Sim.addProp(id: string, half: {x,y,z}, x: number, z: number, massKg: number): void` — dynamic body, CCD off, NOT in `carByCollider` (props never cause damage). `Sim.getBodyState(id)` generalizes `getState` for props (cars keep `getState`; internally shared).
- Game: on start, for each `map.props[i]` create `prop-<i>` with half extents from `MODEL_FOOTPRINTS` × pack scale, mass 25. Snapshot: append prop entries (id, p, q, v:[0,0,0] ok, hp 0). Skip props in combat/roster/HUD logic (already skipped — they're not roster players).
- Client: on welcome, `visuals.ensureProp(id, pack, model)` for every map prop (loads model, no label); transforms flow through the existing interp path (extend the main-loop sampled iteration: ids starting with `prop-` get `setTransform` like the train did).

- [ ] **Step 1: Failing sim test** — prop settles on ground and is shoved by a car driving through it (`p` displaced > 2 m, car barely slowed).
- [ ] **Step 2: Implement sim + game + client** per interfaces.
- [ ] **Step 3: Tests green; manual check** — drive through the construction zone: cones scatter, no damage taken.
- [ ] **Step 4: Commit** — `git commit -m "feat: knockable dynamic props"`

### Task 8: Cargo ship replaces the train

**Files:**
- Delete: `server/src/train.ts` (+ its remaining references)
- Create: `server/src/ship.ts`
- Modify: `server/src/game.ts`, `client/src/cars.ts` (`ensureShip` — `watercraft/ship-cargo-a` at pack scale, no label), `client/src/main.ts` (route `"ship"` snapshots), `scripts/check-train.mjs` → `scripts/check-ship.mjs`

**Interfaces:**
- `class Ship { constructor(sim: Sim, path: {x,z}[]); tick(dt: number): void; snap(): CarSnap }` — same shape as the old `Train` (kinematic box `half {x:5, y:4, z:13}`, speed 6 m/s, y = waterY + 2 so the deck rides above water); id `"ship"`. Uses `sim.addKinematicBox`/`moveKinematic` (already exist).

- [ ] **Step 1: Port train.ts → ship.ts** (path-following code is reusable verbatim; only footprint/speed/y/id change). Wire into `game.ts` (`map.shipPath`), delete train wiring and file.
- [ ] **Step 2: `check-ship.mjs`** — same as check-train but id `"ship"`; run it: ship present and moving.
- [ ] **Step 3: Client visual** — cargo ship sails the outer sea; verify from an island shore screenshot.
- [ ] **Step 4: Tests/typecheck green; commit** — `git commit -m "feat: cargo ship sails the archipelago; train retired to freight yard"`

### Task 9: Bot routes on the archipelago

**Files:**
- Modify: `server/src/bots.ts` (consume `waypointRoutes[team]`)
- Test: `server/src/bots.test.ts`

**Interfaces:**
- Brain uses `map.waypointRoutes[player.team]` (assigned at spawn); everything else (nearest-waypoint retarget, hysteresis reverse, hunt, stuck) unchanged. `nearestWaypoint` stays.

- [ ] **Step 1: Update `spawnAll`** to assign team routes; adjust any tests referencing `waypointLoops`.
- [ ] **Step 2: Arena health check** — `node scripts/watch-bots.mjs 90` on a fresh server: expect most cars moved >20 m, damage events > 50, knockouts > 5. Bots must cross bridges (spot-check with `scripts/trace-bot.mjs` that a bot's x or z crosses a water gap). Falling in the sea occasionally is fine (they respawn); if >5 bots end up swimming per minute, widen `WAYPOINT_REACHED` on bridge points or nudge route points to bridge centers.
- [ ] **Step 3: Commit** — `git commit -m "feat: per-team bot routes across the islands"`

### Task 10: Full regression, docs, production

**Files:**
- Modify: `CLAUDE.md` (map v2 notes: grounds/water/routes/props/ship, footprint table workflow), `docs` unchanged

- [ ] **Step 1: Full suite** — `npm test`, `npm run typecheck` green.
- [ ] **Step 2: Two-tab playtest** (one `?touch` mobile viewport): join both, drive across a bridge, fight near the roundabout, shove a prop, get knocked out, respawn on home island; HP bar thin; labels outlined/team-colored; no drive-through buildings; cars don't flip from normal cornering; a deliberately flipped/sided car respawns in ~3 s; driving into the sea respawns.
- [ ] **Step 3: `npm run start`** — production single-port serve works.
- [ ] **Step 4: Update CLAUDE.md** (architecture bullet for map v2 + "re-measure footprints" workflow). 
- [ ] **Step 5: Commit** — `git commit -m "feat: map v2 regression pass and docs"`

---

## Self-Review Notes (completed)

- **Spec coverage:** islands/sizes/themes (T4/T6), 8 bridges + islets + rails (T4/T5), water + kill floor + no-attribution respawn (T4, reuses v1 hazard logic), grounds data model (T4), measured colliders/no drive-through (T3/T6), road connectivity verified (T5), ramps/construction/freight yard/ghost ship/sea dressing (T6), dynamic props (T7), cargo ship + train retirement (T8), bot routes (T9), labels/ring (T1), HP bar (T1), car anchoring (T1), anti-flip + side detection (T2), tests listed in spec (T2/T4/T9).
- **Type consistency:** `GroundRect`/`PropSpawn`/`waypointRoutes`/`shipPath` defined in T4 and consumed by name in T6–T9; `Ship` mirrors old `Train` interface; `footprintCollider` defined T4, used T5/T6.
- **Placeholder scan:** clean — model lists are explicit; the only deferred content is intentionally staged (T4 skeleton → T6 dressing).
