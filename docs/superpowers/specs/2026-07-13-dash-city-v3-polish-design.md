# Dash City — v3 Polish: Accounts, Mobile Controls, Free-Look, Map Fixes

**Date:** 2026-07-13
**Status:** Approved for planning
**Builds on:** `2026-07-12-dash-city-design.md` (rules) and `2026-07-13-dash-city-islands-design.md` (map). All prior rules stay unless amended here.

## 1. Light join screen

- Bright "showroom" style: light gradient background, dark text, soft shadows; the 3D car preview becomes the visual centerpiece (larger, light pedestal, brighter studio lighting so car colors pop).
- Tagline is exactly "Don't get wrecked." (drop "Knock out rival teams.").
- Fields: name (unchanged rules) + **password** (masked, minimum 4 chars, required). Error messages from the server (wrong password / already online) appear inline on the join screen.

## 2. Accounts & cross-device recovery

- Server-side account store keyed by **lowercase name**, persisted to `data/players.json` (written on every change, loaded at boot — survives restarts; `data/` is git-ignored).
- Stored per account: scrypt password hash + salt, team, car, score, createdAt.
- Join flow:
  - Unknown name → create account with the given password; assign team by the existing balancing rule; store team/car.
  - Known name + correct password → restore **team and score**; the car picked on the join screen wins (players may switch cars) and is saved back to the account.
  - Known name + wrong password → reject with "wrong password for this name"; stay on join screen.
  - Name already connected → reject with "player already online".
- Recovered team overrides balancing (team is permanent per account). Team scores remain a separate accumulator (unchanged).
- Wire protocol: `hello` gains `pass`; new server message `{ t: "reject"; reason: string }`.
- Bots are unchanged and never stored.

## 3. Mobile landscape

- On the PLAY tap (a user gesture), touch devices request fullscreen and `screen.orientation.lock("landscape")`.
- Where locking is unsupported (iOS Safari): show a "rotate your phone 🔄" overlay whenever the viewport is portrait; gameplay is laid out for landscape.

## 4. Mobile controls v2 (Kenney `mobile-controls-1` sprites)

- Assets: copy the needed sprites (joystick pad + nub, pedal icons) into `client/public/assets/ui/` via the asset copy script (source folder stays git-ignored).
- **Left joystick** (pad + draggable nub, semi-transparent "subtle" styling): direction = desired heading **relative to the camera**, magnitude = throttle. Pulling toward the camera (backward) reverses. The car steers itself toward the joystick heading (same steering math bots use).
- **Right pedals**: small gas and brake buttons (pedal icons) as an explicit override — holding gas = full throttle along the car's current heading; brake = brake/reverse. Joystick alone is fully sufficient to drive.
- **No DRIFT button** — auto-drift: the handbrake engages automatically when speed > `AUTO_DRIFT_MIN_SPEED` and |steer| > `AUTO_DRIFT_MIN_STEER` while on throttle (constants in `shared/src/constants.ts`, applied on the CLIENT input side so PC/manual play is unaffected; Space remains manual handbrake on PC).
- All controls visually subtle: ~40% opacity idle, brighter while touched.

## 5. Free-look camera

- **PC:** clicking the canvas grabs the pointer (Pointer Lock). Mouse movement orbits the camera around the car (yaw full circle, pitch clamped). Esc releases the pointer. While driving with no mouse input for >1.5 s, the camera eases back behind the car.
- **Mobile:** touch-drag anywhere that is not a control orbits the camera the same way; same ease-back behavior.
- The joystick's camera-relative steering uses the current camera yaw.

## 6. Road corners fixed with evidence

- Add a temporary `DEBUG_ROADS` strip in the map generator that lays out every `road-bend`, `road-intersection`, and `road-end-round` rotation (0–3) side by side over open ground, each next to labeled straight stubs.
- Photograph the strip close-up, derive the **measured** `BEND_ROT` / `TEE_ROT` / `END_ROT` tables from what actually connects, then delete the strip.
- Acceptance: street-level screenshots of plaza-ring corners, islet bends, and center-ring corners show continuous curbs/lanes with no misaligned tiles.

## 7. Bots that actually escape

- Stuck escape v2: reverse for 2 s steering the nose **toward the current waypoint side** (sign of the bearing angle), then resume. If a bot triggers stuck twice within 10 s, it re-targets the nearest waypoint on its route and tries a different escape steer sign.
- Acceptance: in a 3-minute `watch-bots` run, ≥ 18/21 cars move > 20 m and bots visibly reverse out when pinned (spot-check with `trace-bot`).

## 8. Half-visible buildings fixed

- Cause: models with off-center geometry (measured `cx/cz` offsets, e.g. industrial warehouses) are placed by pivot, so their visuals extend into neighbouring tiles/water while colliders (measured) stay put.
- Fix: the map generator emits tiles positioned so the model's **bbox center** lands on the tile center — i.e. subtract the rotated `(cx, cz) × scale` offset when computing the tile's fractional grid position; colliders then use the same centered position. One code path fixes every offset model.
- Acceptance: harbor warehouses sit fully on their tiles; no building bisected by water or a neighbour.

## 9. Name labels

- Own car: no label at all.
- Other cars: labels keep the team-colored outlined style but render **with depth testing**, so buildings occlude them.

## Testing

- Unit: account store (create/verify/persist/reload, wrong password, scrypt roundtrip), protocol `hello.pass` + `reject`, auto-drift input mapping (pure function), camera-relative joystick → steer mapping (pure function), bot escape steer-sign choice.
- Existing suites stay green; map determinism preserved.
- Manual: join → disconnect → rejoin with password from a "second device" (second tab) restoring score/team; landscape + joystick + auto-drift on the mobile viewport; pointer-lock orbit on desktop; road-corner and building screenshots; watch-bots healthy.

## Out of scope

- Password reset flows, email, uniqueness beyond name collision
- Encrypting `data/players.json` (hashes only, plaintext file)
- Gamepad support
- Minimap
