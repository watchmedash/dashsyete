# How the SIX SIDES Cube Planet Works

A porting guide for converting a voxel game with a round/flat planet to an
**axis-aligned cube planet where all six faces are walkable ground**. This
documents only the cube mechanics — geometry, gravity, face frames, edge
transitions, camera, and terrain generation — with the exact math and the
hard-won gotchas. Everything here is engine-agnostic except where noted
(physics is Rapier, rendering is three.js; the math transfers as-is).

All source references: `shared/src/gravity.ts` (the whole coordinate model,
~140 lines, self-contained), `shared/src/skyMap.ts` (generation),
`shared/src/sim.ts` (movement + face transitions), `client/src/camera.ts`
(view-up handling).

---

## 1. Geometry and coordinates

- The planet is a solid **axis-aligned voxel cube centered on the origin**.
  With half-size `PLANET_R = 112`, integer block coordinates span
  **`[-R, R-1]` on every axis** (an even 2R blocks per side, no center block).
- The **face planes sit at exactly ±R**: the top surface of a `+`-face block
  at coordinate `R-1` is the plane `R`; the bottom of a `-`-face block at
  `-R` is the plane `-R`. Keep this convention straight everywhere — it is
  what makes face-membership tests, spawn foot positions, and edge seams
  line up.
- There is **no coordinate wrapping, no distortion, no cube-to-sphere
  mapping**. World space is plain Cartesian; a "face" is purely a question
  of which axis dominates your position. This is the big win over a round
  planet: voxels stay perfectly cubic and grid-aligned everywhere, chunks
  are ordinary 16³ arrays, and all existing flat-world voxel code (meshing,
  raycasts, block edits) works unchanged.

The whole cube-planet trick is exactly one idea:

> **Gravity is not `-Y`. Gravity is "toward the origin along the dominant
> axis of your position."** Everything else — movement, camera, aim,
> terrain — is that one substitution carried through consistently.

## 2. `faceUp`: which face owns a position

The outward normal ("local up") for any world position:

```ts
export const PLANET_R = 112;
export type V3 = [number, number, number];

export function faceUp(p: V3, prev: V3 | null, planet: boolean): V3 {
  if (!planet) return [0, 1, 0];                 // flat maps degenerate to +Y
  const ax = Math.abs(p[0]) - PLANET_R;
  const ay = Math.abs(p[1]) - PLANET_R;
  const az = Math.abs(p[2]) - PLANET_R;
  const max = Math.max(ax, ay, az);
  if (prev) {
    // SIGNED distance beyond the previous face's plane. Using |dot| here
    // confuses a face with its OPPOSITE face (the "respawned upside down
    // on the far side" bug).
    const along = p[0]*prev[0] + p[1]*prev[1] + p[2]*prev[2] - PLANET_R;
    if (along + 0.6 >= max) return prev;         // hysteresis: keep old face
  }
  if (ax >= ay && ax >= az) return [p[0] >= 0 ? 1 : -1, 0, 0];
  if (ay >= az)             return [0, p[1] >= 0 ? 1 : -1, 0];
  return [0, 0, p[2] >= 0 ? 1 : -1];
}
```

Three deliberate choices in there:

1. **The metric is distance beyond the face PLANE (`|p_i| − R`), not just
   the largest |coordinate|.** Both give the same answer far from edges,
   but the plane metric makes transitions fire right at the surface when
   you fall off an edge cliff, instead of deep past the corner — without it
   a player walking off an edge "skydives past" the next face before
   gravity turns.
2. **Hysteresis via `prev` (+0.6 blocks).** Standing exactly on an edge
   must not flip-flop your gravity every frame. You stay on your previous
   face until another face beats it by a clear margin.
3. **The hysteresis test uses the SIGNED dot with `prev`.** An absolute
   value would treat the opposite face as "still the same face" and a
   player teleported/respawned to the far side would keep the old up
   forever, standing on the ceiling.

Gravity is then simply `v -= faceUp * GRAVITY * dt` (with a terminal
velocity clamp), applied along whatever `faceUp` currently is.

## 3. Face frames: making all flat-world math reusable

Every face gets a deterministic orthonormal frame `(t1, up, t2)`:

```ts
export function basis(up: V3): { t1: V3; t2: V3 } {
  const ref: V3 = Math.abs(up[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
  const t1 = cross(up, ref);
  const t2 = cross(t1, up);
  return { t1, t2 };
}
```

Key property: **`basis(+Y)` yields `t1 = +X`, `t2 = +Z`** — the classic
flat-world frame. So every formula written against this frame degenerates
**bit-for-bit** to the original flat math on the top face (and on any
legacy flat map). This is the porting strategy in one line: take every
place your codebase hardcodes `+Y`/`X`/`Z` semantics (movement, jump, aim,
camera, "height above ground", eye offset) and re-express it in
`(t1, up, t2)`. If the top face behaves identically to your old game, the
substitution is correct; the other five faces come for free.

Yaw and pitch are **face-local** angles. Aim direction from them:

```ts
export function dirFromYawPitch(yaw: number, pitch: number, up: V3): V3 {
  const { t1, t2 } = basis(up);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sy = Math.sin(yaw),  cy = Math.cos(yaw);
  return [
    (t1[0]*sy + t2[0]*cy) * cp + up[0]*sp,
    (t1[1]*sy + t2[1]*cy) * cp + up[1]*sp,
    (t1[2]*sy + t2[2]*cy) * cp + up[2]*sp,
  ];
}
// inverse (yaw part):
export function yawFromDir(dir: V3, up: V3): number {
  const { t1, t2 } = basis(up);
  return Math.atan2(dot(dir, t1), dot(dir, t2));
}
```

Character orientation is `quatUpYaw(up, yaw)`: the quaternion mapping local
`+Y → up`, `+Z → t2` (built from the column matrix `(t1, up, t2)`),
composed with a spin about `up` by `yaw`. On the wire we still send a
single scalar yaw plus (implicitly, from position) the face — a full
quaternion never needs to cross the network.

**Movement**: desired velocity is computed in the face frame —
`wish = t1 * (moveInput rotated by yaw) + t2 * (...)`, gravity/jump on the
`up` axis — and handed to the character controller with the controller's
own up vector set per-tick (`controller.setUp(up)` in Rapier). Grounded
checks, step-offset, snap-to-ground all key off that up.

## 4. Edge transitions (the part that will eat your weekend)

Crossing a cube edge rotates gravity 90° under the player. The naive
version (`char.up = faceUp(pos, prev, true)` every tick) *almost* works.
The fixes that made it actually feel right:

### 4a. NEVER transition while rising

```ts
const rising = dot(char.v, char.up) > 1;   // moving away from current face
const nu = rising ? char.up : faceUp(pos, char.up, true);
```

Jumping right at an edge used to transition at the apex ambiguity — the new
face reinterprets your outward momentum as sideways momentum, turning your
jump into a **return trajectory that lands you back on the takeoff spot**
(or worse, oscillating between faces). Rule: while your velocity has a
positive component along the current up (> 1 m/s), the face is frozen.
Falling or walking off an edge still transitions immediately.

### 4b. Carry yaw across the edge

When the face flips, a raw yaw number means something different in the new
frame. Rotate the old forward vector by the same 90° the up vector rolled
(Rodrigues with axis `a = oldUp × newUp`, cos 90° = 0, sin 90° = 1):

```ts
export function carryYaw(yaw: number, oldUp: V3, newUp: V3): number {
  const f = dirFromYawPitch(yaw, 0, oldUp);
  const a = cross(oldUp, newUp);
  const al = Math.hypot(a[0], a[1], a[2]);
  if (al < 1e-6) return yaw;               // same or opposite face
  const an: V3 = [a[0]/al, a[1]/al, a[2]/al];
  const axf = cross(an, f);
  const ad  = dot(an, f);
  const rf: V3 = [axf[0] + an[0]*ad, axf[1] + an[1]*ad, axf[2] + an[2]*ad];
  return yawFromDir(rf, newUp);
}
```

Without this, walking over an edge snaps your view 90° sideways.

### 4c. Clean seams in the terrain

Terrain height fades to zero within ~6 blocks of every face border
(section 6), so edges are clean 90° seams of bare shell — the player walks
around a crisp corner rather than colliding with two faces' mountains
interpenetrating at the edge.

## 5. Camera: smoothed view-up

Physics up snaps instantly at a transition; the **camera up must not**. The
camera keeps its own `viewUp` that exponentially chases the physics up
(`lerp` factor `1 − exp(−6·dt)`, then normalize), so the horizon *rolls*
90° over a fraction of a second instead of snapping.

Two mandatory details:

- **Antipodal guard.** Lerping toward the exact opposite up is degenerate:
  the blend stays collinear and `normalize()` pins it right back, so a
  player spawning on the far face rendered **upside down forever**. When
  `viewUp · targetUp < −0.9`, nudge `viewUp` along a face tangent
  (`viewUp += t2 * 0.25`, normalize) so the roll has a path to follow.
- **`snapUp()` on spawn/respawn/teleport.** Hard-set `viewUp` to the new
  face's up so you arrive standing upright with no cinematic roll from
  wherever the camera previously was.

The camera then just does `camera.up.copy(viewUp); camera.lookAt(target)`
with the look direction built by `dirFromYawPitch(yaw, pitch, up)`.

## 6. Terrain generation on a cube

Generation is deterministic from one integer seed (server and every client
build the identical world; live edits ship as deltas). Structure:

### 6a. Face-local (u, v) coordinates

Each face is described by its normal and two tangent axes:

```ts
const FACES = [
  { n: [0, 1, 0],  a: [1, 0, 0], b: [0, 0, 1] },   // +Y
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },   // -Y
  { n: [1, 0, 0],  a: [0, 1, 0], b: [0, 0, 1] },   // +X
  { n: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },   // -X
  { n: [0, 0, 1],  a: [1, 0, 0], b: [0, 1, 0] },   // +Z
  { n: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },   // -Z
];

/** Block coordinate for face f at in-face (u,v), k blocks OUT from the
 * shell surface (k=0 = the outermost shell block itself; k<0 digs in). */
function faceCell(f, u, v, k) {
  const out = (n) => (n > 0 ? PLANET_R - 1 + k : -PLANET_R - k);
  return [
    f.n[0] !== 0 ? out(f.n[0]) : f.a[0]*u + f.b[0]*v,
    f.n[1] !== 0 ? out(f.n[1]) : f.a[1]*u + f.b[1]*v,
    f.n[2] !== 0 ? out(f.n[2]) : f.a[2]*u + f.b[2]*v,
  ];
}
```

`faceCell` is the universal adapter: **any existing flat-world 2D feature
generator (heightmaps, lakes, trees, structures) runs unchanged in (u, v)
space and gets mapped onto the face**, with "one block up" meaning "one
step along the face normal." This is how six faces of terrain reuse one
flat generator.

### 6b. The base cube: Chebyshev depth shells

The solid cube is filled in one pass, layered by **Chebyshev distance from
the nearest face**:

```ts
// depth 0 = the outermost block of whatever face is nearest
const depth = R - 1 - Math.max(
  Math.max(x, -1 - x),
  Math.max(Math.max(y, -1 - y), Math.max(z, -1 - z)),
);
// (the -1-x form handles the asymmetric [-R, R-1] span exactly)
block = depth >= BEDROCK_DEPTH ? BEDROCK          // unbreakable core
      : depth === 0            ? biome.surface     // grass/sand/snow/…
      : depth <= 2             ? biome.sub         // dirt/ice/…
      : biome.deep;                                // stone
```

Which biome a cell uses comes from which face it is nearest to (dominant
axis of the **cell center** `(x+0.5, …)` — using centers avoids off-by-one
face assignment on the asymmetric span). `BEDROCK_DEPTH = 6`: everything
deeper than 6 blocks under every face is unbreakable, so nobody tunnels to
the planet's center or through to the opposite face. This also means the
"core" needs no special geometry at all — it's just bedrock.

Perf note: fill whole 16³ chunk arrays directly rather than calling a
per-block `set()` (millions of map-lookup `set` calls made generation take
seconds).

### 6c. Mountains, on top of the shell

Per face: a **ridged-noise 2D heightfield** in (u, v) — `ridge = 1 −
|2n−1|`, squared to keep plains between crests, peak height ~12 blocks —
plus fine detail noise, then two crucial post-passes:

1. **Border fade**: `fade = min(1, distToFaceBorder / 6)` multiplies the
   height, so terrain flattens to bare shell at every edge → clean 90°
   corner seams (see 4c).
2. **Slope limiting**: iterate until no cell is more than 1 block above any
   4-neighbor. Every hill on the planet is climbable with single jumps —
   no unclimbable noise cliffs.

Extra height is written outward along the face normal via `faceCell(f, u,
v, k)` for `k = 1..h`, with surface/sub/deep block layering repeated at the
new surface.

### 6d. Lakes, vegetation, spawn points

All run in face-local (u, v) space and are therefore ordinary flat-world
algorithms:

- **Lakes**: noisy circular blobs; carve any terrain above the shell, then
  dig a real 2–3-block basin *into* the shell (`k = 0, -1, -2`) and fill
  with the biome's fluid (water, or lava on the volcanic face). Kept ≥ 2
  blocks from face borders.
- **Trees/cacti**: planted only where the surface block is the biome's
  walkable top; trunk grows along the face normal; canopy offsets are
  expressed in `(a, b, n)` face axes so one tree function builds correctly
  oriented trees on all six faces.
- **Spawns**: candidate (u, v) points per face, accepted only if the
  surface block is walkable and 2 cells above are clear; the spawn "foot"
  position sits on the exact surface plane (`±R` + terrain height along
  the normal).

One deterministic-RNG warning: all features share one seeded RNG stream, so
**any change to the number of RNG calls reshuffles the entire planet**.
Fine during development, but saved worlds / tests / spawn tables must be
recomputed.

### 6e. One biome per face

Faces are the natural biome unit — each face gets its own surface/sub/deep
blocks, tree style, lake fluid, and **movement physics multipliers**
(gravity, speed, jump, fall damage) applied by reading
`BIOMES[faceIndexOfUp(char.up)]` in the movement step. Ours: grassland +Y,
volcanic −Y (heavy/slow, lava lakes), desert +X, antarctic −X (slow),
forest +Z, moon −Z (0.5× gravity, high jumps). Per-face physics is nearly
free once the face frame exists, and it makes each side feel like a
different world.

### 6f. Day/night on a cube

The sun (and a moon on the opposite side) **orbits the cube** in a fixed
plane; each face gets day when the sun's direction has positive dot with
its normal. Trick: **tilt the orbit axis** so the path grazes or misses
chosen faces — ours misses ±X/±Z enough that the desert face gets its own
fixed "eternal noon" light and the moon face stays in permanent night,
while the other faces cycle normally. Orbit phase is derived from the
server clock so all clients agree.

## 7. Physics/engine integration notes (Rapier-specific but instructive)

- Kinematic character controller: pass the current face up to the
  controller every tick (`controller.setUp`). The capsule's rigid-body
  rotation is set to `quatFace(up)` so the collider's long axis is along
  the face normal.
- The character's "foot" position API stays `(x, groundY, z)`-shaped for
  compatibility, but center = foot + `up * capsuleHalfHeight` — do the
  offset along `up`, not `+Y`.
- Fall out into space: a kill distance of `4 × PLANET_R` from the origin
  (`hypot(p) > PLANET_KILL_DIST` → respawn). There is no "kill plane" on a
  cube planet, only a kill radius.
- If you do client prediction: the correction offset between predicted and
  authoritative position must be **full 3D + yaw**, not just horizontal +
  vertical — on a cube planet the "jump axis" can be any world axis.

## 8. Gotcha checklist (each of these was a real bug)

1. `faceUp` hysteresis must use the **signed** dot with the previous up —
   `|dot|` makes the opposite face look like the same face (upside-down
   respawns).
2. Face-membership metric = distance beyond the **plane** (`|p_i| − R`),
   not raw dominant axis — otherwise edge falls "miss" the next face.
3. **Never flip face while moving away from the current face** (rising
   check) — edge jumps become boomerangs otherwise.
4. `carryYaw` on every face change, or the view snaps 90°.
5. Camera up is **smoothed separately** from physics up; antipodal nudge or
   far-side spawns render inverted forever; `snapUp` on spawn/teleport.
6. Cell-center (`+0.5`) when classifying which face a block belongs to —
   the `[-R, R-1]` span is asymmetric.
7. Fade terrain to zero near face borders — or edge corners are geometry
   soup.
8. Deterministic seeded gen: RNG call-count changes reshuffle everything.
9. Everything that ever assumed `up = +Y` — eye height, muzzle offsets, HUD
   pitch clamps, "am I above the ground" checks, water surface tests,
   nameplate offsets — must be rewritten against `(t1, up, t2)`. Grep for
   literal `.y` accesses; each one is a suspect.
10. Verify by symmetry: whatever works on +Y must behave *identically* on
    the other five faces. A quick automated test: spawn a probe on each
    face, walk forward N ticks, assert distance traveled matches +Y's.
