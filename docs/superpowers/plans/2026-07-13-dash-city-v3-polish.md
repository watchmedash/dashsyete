# Dash City v3 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts with password recovery, light showroom join screen, landscape mobile with joystick/pedals/auto-drift, free-look camera, and fixes for road corners, stuck bots, half-visible buildings, and name-label visibility.

**Architecture:** Accounts are a server-side JSON-persisted store consulted in the `hello` flow (new `pass` field + `reject` message in the shared protocol). All input-feel features (joystick mapping, auto-drift) are pure client-side input functions with unit tests. Map fixes stay inside `shared/src/cityMap.ts` (bbox-centered placement; measured rotation tables via a debug strip). Camera gains an orbit state consulted by `ChaseCamera`.

**Tech Stack:** unchanged (Three.js, Rapier compat, ws, Vitest, tsx/Vite). New: `node:crypto` scrypt for password hashing; Kenney `mobile-controls-1` sprites for touch UI.

**Spec:** `docs/superpowers/specs/2026-07-13-dash-city-v3-polish-design.md`. Read `CLAUDE.md` (physics gotchas + testing notes) first. The Playwright browser window is occluded: rAF ~1 fps there; game logic runs on timers; use the `?fly` mode's `__cap` hook pattern for world screenshots.

## Global Constraints

- Tagline is exactly "Don't get wrecked."
- Password: masked field, min 4 chars, required; scrypt hash + salt in `data/players.json` (git-ignored); accounts keyed by lowercase name.
- Team and score restore on login; the join-screen car pick wins and is saved back.
- Auto-drift constants live in `shared/src/constants.ts`: `AUTO_DRIFT_MIN_SPEED = 14`, `AUTO_DRIFT_MIN_STEER = 0.55` (tune by feel; client-side only).
- Own car: no label. Remote labels: depth-tested.
- All prior invariants (server-authoritative inputs, shared-first geometry, same-team zero damage) unchanged.
- Every task ends with `npm run typecheck` + `npm test` green before committing.

---

### Task 1: Name labels — hide own, occlude others

**Files:**
- Modify: `client/src/cars.ts` (`ensure` gains `isSelf` param; label `depthTest: true`), `client/src/main.ts` (pass `info.id === myId`)

- [ ] **Step 1:** `CarVisuals.ensure(info: PlayerInfo, isSelf = false)` — skip `makeLabel` when `isSelf`; in `makeLabel`, `SpriteMaterial({ map, depthTest: true })`. In `main.ts` welcome/join handlers call `visuals.ensure(p, p.id === myId)` (welcome arrives before visuals are created — `myId` is set first, verify order).
- [ ] **Step 2:** Manual verify (2 tabs): no label over own car; other car's label disappears behind a skyscraper.
- [ ] **Step 3:** `npm run typecheck && npm test` green → `git commit -m "fix: hide own name label, occlude remote labels behind buildings"`

### Task 2: Bbox-centered building placement (half-visible buildings)

**Files:**
- Modify: `shared/src/cityMap.ts` (`place` and `placeC` helpers)
- Test: existing `cityMap` suite guards determinism/spawn-clearance

The bug: models are placed by pivot; off-center models (industrial `building-h/i/j/n/o`: `cx ≈ -0.5`) visually spill into neighbouring tiles/water while their measured colliders sit correctly.

- [ ] **Step 1:** In `place(...)` and `placeC(...)`, compute the anchor so the model's bbox center lands on the intended spot: look up `MODEL_FOOTPRINTS[key]`, rotate `(cx, cz) * scale` by the world rot (same rotation math as `footprintCollider`), and subtract it from the target world position BEFORE emitting the fractional-tile position; call `footprintCollider(pack, model, scale, anchorX, anchorZ, rot)` with the same anchor (its internal `+offset` then re-centers the collider on the tile — visual and collider stay identical).

```ts
const off = rotatedOffset(pack, model, scale, wrot); // {x, z} — extract the existing rot math into this helper
const ax = x - off.x;
const az = z - off.z;
tiles.push({ gx: (ax - TILE / 2) / TILE + SIZE / 2, gz: (az - TILE / 2) / TILE + SIZE / 2, ... });
if (solid) colliders.push(footprintCollider(pack, model, scale, ax, az, wrot));
```

- [ ] **Step 2:** `npm test` green (determinism test recomputed). Visual verify via `?fly`: harbor warehouses (east island) sit fully on land, nothing bisected at shorelines.
- [ ] **Step 3:** Commit — `git commit -m "fix: center models on their bbox so off-center buildings sit on their tiles"`

### Task 3: Road rotation tables measured from a debug strip

**Files:**
- Modify: `shared/src/cityMap.ts` (`DEBUG_ROADS` strip + corrected `BEND_ROT`/`TEE_ROT`/`END_ROT`)

- [ ] **Step 1:** Behind `const DEBUG_ROADS = false` at the top of `buildCityMap`, when true add: for rot 0–3, place `road-bend` at tiles (18+i*3, 33) with a `road-straight` stub on each side it should connect; same rows for `road-intersection` (z 35) and `road-end-round` (z 37) — all on a temporary ground rect south of the center island. Flip flag, `?fly` + `__cap(6, 60, 480, 6, 0, 420)` close-ups.
- [ ] **Step 2:** From the screenshots, write the true connection table as comments and fix `BEND_ROT` (key = sorted connected sides), `TEE_ROT` (key = stem side), `END_ROT` (key = connected side). Flip `DEBUG_ROADS` back to false (leave the strip code — it's the measuring instrument).
- [ ] **Step 3:** Street-level verification captures: north plaza ring corners, an islet bend, center ring corner, a T on the island grid, a dead end. All curbs continuous.
- [ ] **Step 4:** `npm test` green → `git commit -m "fix: road bend/tee/end rotations measured from debug strip"`

### Task 4: Bots escape when stuck

**Files:**
- Modify: `server/src/bots.ts`
- Test: `server/src/bots.test.ts`

**Interfaces:**
- Produces: `escapeSteer(bearingAngle: number): number` (pure, exported) — reverse-steer sign that swings the nose toward the waypoint (mirror of the verified reverse-turn convention: `-Math.sign(angle)`).

- [ ] **Step 1: Failing tests** — `escapeSteer(+1.2)` < 0, `escapeSteer(-1.2)` > 0; and a Brain-level test: construct `Bots` against a stub Game (roster + sim fakes) is heavy — instead test the pure pieces and rely on the live check below.
- [ ] **Step 2: Implement.** In `tick()`: when stuck triggers, set `reversingUntil = now + 2`, store `escapeSteerSign = escapeSteer(bearing to current waypoint)`; the reversing branch sends `{ throttle: -1, steer: brain.escapeSteerSign }`. Track `lastStuckAt`; if a bot re-triggers stuck within 10 s: `brain.waypoint = nearestWaypoint(...)` and flip `escapeSteerSign`.
- [ ] **Step 3: Live check** — fresh server, `node scripts/watch-bots.mjs 180`: ≥18/21 moved >20 m, knockouts still flowing; `trace-bot` on a pinned bot shows reverse (negative velocity along heading) then recovery.
- [ ] **Step 4:** Commit — `git commit -m "fix: bots reverse out of stuck states toward their waypoint"`

### Task 5: Accounts — store, protocol, join flow (TDD)

**Files:**
- Create: `server/src/accounts.ts`
- Modify: `shared/src/protocol.ts` (hello.pass, reject), `server/src/game.ts` (join flow), `.gitignore` (`data/`)
- Test: `server/src/accounts.test.ts`, `shared/src/protocol.test.ts`

**Interfaces:**
- Produces:

```ts
// accounts.ts
export interface Account { nameKey: string; name: string; hash: string; salt: string; team: TeamId; car: string; score: number; createdAt: number; }
export type LoginResult = { ok: true; account: Account; created: boolean } | { ok: false; reason: string };
export class Accounts {
  constructor(file: string);            // loads JSON if it exists (mkdir -p the dir)
  login(name: string, pass: string, car: string, teamIfNew: TeamId): LoginResult;
  // created: hashes pass (crypto.scryptSync(pass, salt, 32), salt = randomBytes(16).hex)
  // existing: timingSafeEqual on recomputed hash; on success updates car (pick wins) + returns account
  setScore(nameKey: string, score: number): void;  // persists (debounced write is unnecessary — file is tiny)
  save(): void;                          // writeFileSync(file, JSON.stringify([...accounts]))
}
// protocol.ts
// ClientMsg hello: { t: "hello"; name: string; car: string; pass: string }   (decodeClient: pass = String(m.pass ?? "").slice(0, 64))
// ServerMsg add:   { t: "reject"; reason: string }
```

- Game flow on hello: `pass.length < 4` → send reject "password must be at least 4 characters". Name already in `sockets`' roster (non-bot, connected) → reject "player already online". Else `accounts.login(name, pass, car, pickTeam(humanCounts))` → on `ok: false` send reject; on ok create the Player with `team = account.team`, `score = account.score`, then proceed as before. On every knockout score change for a human, call `accounts.setScore`.

- [ ] **Step 1: Failing tests** in `server/src/accounts.test.ts` (use a temp file path in the scratchpad/os.tmpdir):

```ts
// create: login("Zed", "hunter2", "suv", 1) → ok, created true, team 1, score 0
// wrong pass: login("Zed", "wrong", ...) → ok false, reason mentions password
// correct pass: restores team/score, updates car to the new pick
// persistence: setScore("zed", 7); new Accounts(sameFile) → login returns score 7
// case-insensitive: "ZED" hits the same account
```

Plus protocol tests: hello round-trips `pass`, decodeServer accepts `reject`.
- [ ] **Step 2:** Run → FAIL. Implement `accounts.ts` + protocol changes. Run → PASS.
- [ ] **Step 3:** Wire into `game.ts` (Game.start takes the data file path `data/players.json`; add `data/` to `.gitignore`). Rejected sockets stay open (client may retry with another name).
- [ ] **Step 4:** Live verify with a modified fake-client sending a pass: join, score via bots impossible to force — instead verify reject paths (wrong pass, duplicate online) with two fake clients.
- [ ] **Step 5:** `npm test` + typecheck → `git commit -m "feat: password accounts with cross-device recovery"`

### Task 6: Light showroom join screen + password field

**Files:**
- Modify: `client/src/ui/join.ts`, `client/src/ui/style.css`, `client/src/net.ts` (surface reject), `client/src/main.ts` (retry loop)

- [ ] **Step 1: Restyle.** `.overlay`: light gradient (`#f4f6fa → #dde3ec`), dark text (`#1c2333`), title dark with subtle shadow; tagline exactly "Don't get wrecked."; preview panel: white/very-light pedestal scene (`scene.background #eef1f6`, pedestal `#ffffff` cylinder, brighter hemisphere + two directional lights), preview takes ~55% of panel height; inputs: white fields, light borders, dark text; PLAY keeps the blue→green gradient. Password input `type="password"` `minlength=4` below/next to name; `.join-error` red line (hidden until set).
- [ ] **Step 2: Flow.** `showJoinScreen(error?: string)` displays the error; `main.ts` loops: show screen → connect (once) → `sendHello(name, car, pass)` → on `welcome` proceed; on `reject` re-show join screen with the reason (keep ws open; `Net.sendHello` reusable).
- [ ] **Step 3:** Verify: screenshot the light screen (cars pop); wrong-pass double-join shows inline error; happy path enters game.
- [ ] **Step 4:** Commit — `git commit -m "feat: light showroom join screen with password"`

### Task 7: Free-look camera (pointer lock + swipe orbit)

**Files:**
- Create: `client/src/look.ts`
- Modify: `client/src/camera.ts`, `client/src/main.ts`

**Interfaces:**
- Produces: `class FreeLook { readonly yaw: number; readonly pitch: number; readonly active: boolean; attach(canvas: HTMLCanvasElement): void; tick(dt: number, driving: boolean): void }` — pointer-lock on canvas click (desktop), touch-drag outside `.touch-controls` elements (mobile); `active` true while recent input (<1.5 s); when inactive, yaw/pitch ease back to 0.
- `ChaseCamera.update(dt, carPos, carQuat, look: { yaw: number; pitch: number })` — offsets the orbit around the car by look.yaw (full circle) and look.pitch (clamped −0.2..0.9 rad).
- `main.ts` exposes `cameraYaw()` (world yaw of the camera) for Task 9's joystick mapping.

- [ ] **Step 1:** Implement `look.ts` (pointermove deltas ÷ ~600 for radians; pointer lock via `canvas.requestPointerLock()`; touch: pointerdown NOT on `.touch-controls *` starts a drag). `camera.ts`: rotate the back-offset vector by look.yaw around Y and raise/lower by pitch before lerping.
- [ ] **Step 2:** Verify desktop: click canvas → move mouse → camera orbits all the way around the car; Esc frees the mouse; after driving 2 s w/o mouse, camera returns behind car. Mobile viewport: swipe orbits, joystick untouched by swipes.
- [ ] **Step 3:** Commit — `git commit -m "feat: free-look camera (pointer lock / swipe orbit with ease-back)"`

### Task 8: Mobile landscape

**Files:**
- Modify: `client/src/ui/join.ts` (lock on PLAY tap), `client/src/ui/style.css` + `client/index.html` (rotate overlay)

- [ ] **Step 1:** In `play()` on coarse-pointer devices: `document.documentElement.requestFullscreen().catch(...)` then `screen.orientation.lock("landscape").catch(...)` (both fire inside the tap gesture; failures are silent). Add `<div class="rotate-overlay">🔄 Rotate your phone</div>` shown via CSS `@media (orientation: portrait) and (pointer: coarse)` only while `.hud` exists (gate with a `body.playing` class added on join).
- [ ] **Step 2:** Verify in the mobile viewport (390×740 → overlay shows after joining; 740×390 → game fills landscape).
- [ ] **Step 3:** Commit — `git commit -m "feat: landscape lock + rotate overlay on mobile"`

### Task 9: Mobile controls v2 — joystick, pedals, auto-drift (TDD on the math)

**Files:**
- Create: `client/src/joystick.ts` (pure math + widget), `client/src/joystick.test.ts`
- Modify: `client/src/touch.ts` (rebuild UI), `client/src/ui/style.css`, `client/src/main.ts` (input merge uses camera yaw), `scripts/copy-assets.mjs` (copy `mobile-controls-1` sprites → `client/public/assets/ui/`), `shared/src/constants.ts` (`AUTO_DRIFT_MIN_SPEED = 14`, `AUTO_DRIFT_MIN_STEER = 0.55`)

**Interfaces:**
- Produces (pure, unit-tested):

```ts
// joystick.ts
export function joystickToInput(
  jx: number, jy: number,          // joystick offset, each -1..1, y+ = pulled DOWN (toward player)
  cameraYaw: number,               // world yaw of the camera (radians)
  carHeading: number,              // world yaw of the car
): { steer: number; throttle: number } {
  // magnitude < 0.15 deadzone → {0,0}
  // desired world heading = cameraYaw + atan2(jx, -jy)   (push up = away from camera)
  // angle = wrap(desired - carHeading); |angle| > 2.4 → reverse toward it (throttle -0.8, steer -sign(angle))
  // else steer = clamp(angle * 1.5), throttle = magnitude
}
export function autoDrift(speed: number, steer: number, throttle: number): boolean {
  return speed > AUTO_DRIFT_MIN_SPEED && Math.abs(steer) > AUTO_DRIFT_MIN_STEER && throttle > 0.5;
}
```

- `TouchInput` rebuild: left joystick widget (`joystick_circle_pad_b.png` base + `joystick_circle_nub_b.png` nub, 40% idle opacity, 80% while touched, nub follows finger clamped to pad radius); right column: two round buttons with `icon_pedal.png` (gas) and `icon_pedal_brake.png` (brake), same subtle opacity. `current()` returns `{ jx, jy, gas, brake }`; `main.ts` merges: joystick → `joystickToInput(jx, jy, cameraYaw(), carHeading())`; gas held → throttle 1 (keep joystick steer); brake held → throttle −1; then `handbrake = autoDrift(predictedSpeed, steer, throttle)` on coarse-pointer devices. PC path untouched (Space = manual handbrake).
- `main.ts` needs `carHeading()` and `predictedSpeed()` from the prediction transform (yaw extraction as in bots; speed from consecutive positions or expose `LocalPrediction.getVelocity()` — add `getVelocity(): [number,number,number]` returning `sim.getState("me").v`).

- [ ] **Step 1: Failing tests** in `client/src/joystick.test.ts`: deadzone; push-up with camera behind car (`cameraYaw=carHeading=0`, jy=-1) → steer≈0, throttle≈1; push-right → positive/negative steer per the verified convention (camera-relative right of car heading = yaw decrease = steer < 0); pull-down → reverse throttle; `autoDrift` threshold cases.
- [ ] **Step 2:** Implement pure functions → tests PASS.
- [ ] **Step 3:** Asset copy (add `mobile-controls-1/Sprites/Style B/Default` picks to `copy-assets.mjs` targets `client/public/assets/ui/`), build widget + wire input merge. Delete the old steer-zone/GAS/BRAKE/DRIFT UI.
- [ ] **Step 4:** Verify mobile viewport (`?touch`): joystick drives camera-relative (push toward a building — car goes there), pedals work, hard fast turns show drift (handbrake in `window.__input()`), controls subtle, swipes outside controls orbit the camera.
- [ ] **Step 5:** Commit — `git commit -m "feat: joystick + pedal touch controls with auto-drift"`

### Task 10: Regression, docs, production

**Files:**
- Modify: `CLAUDE.md` (accounts/data file, joystick/auto-drift, free-look, label rules)

- [ ] **Step 1:** `npm test` + `npm run typecheck` green; `npm run start` serves on :8080 (game + accounts file created).
- [ ] **Step 2:** Two-tab playtest: create account in tab A, knock a bot (or get score via bots), close, rejoin in "another device" tab with same name+pass → team & score restored; wrong pass rejected inline. Mobile viewport landscape: joystick + pedals + auto-drift + swipe look. Desktop: pointer-lock look.
- [ ] **Step 3:** Screenshot pass on road corners (Task 3 acceptance) and harbor buildings (Task 2 acceptance) in the final build.
- [ ] **Step 4:** Update `CLAUDE.md`; commit — `git commit -m "feat: v3 polish regression pass and docs"`

---

## Self-Review Notes (completed)

- **Spec coverage:** §1 join restyle+tagline (T6), §2 accounts/protocol/persistence/duplicate-online (T5, UI in T6), §3 landscape (T8), §4 joystick/pedals/auto-drift/asset copy/subtle (T9), §5 free-look PC+mobile+ease-back (T7, joystick uses cameraYaw in T9), §6 road tables via debug strip (T3), §7 bot escape (T4), §8 bbox-centered buildings (T2), §9 labels (T1), testing section covered by per-task tests + T10 regression.
- **Type consistency:** `FreeLook.yaw` consumed by `cameraYaw()` (T7→T9); `joystickToInput`/`autoDrift` signatures fixed in T9 and tested there; `Accounts.login` result shape used by game flow in T5; `hello.pass`/`reject` defined once (T5) and consumed in T6.
- **Placeholder scan:** clean.
- **Ordering note:** T1–T4 are independent fixes (do first, they're what the user sees immediately); T5→T6 ordered (protocol before UI); T7 before T9 (camera yaw feeds joystick).
