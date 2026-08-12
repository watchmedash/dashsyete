# Skyblock Blaster (v5) — Design

Replaces the downtown city with a **Minecraft-style floating sky-island world**
made of 1 m voxel blocks. Same FFA blaster deathmatch (characters, weapons,
crates, K/D, spawn protection, death cam) — plus **full build & destroy**.

## World
- Several floating islands at different heights, connected by plank bridges:
  one main island (~64×64 footprint) plus 2-3 satellites. Procedural but
  DETERMINISTIC (seeded) — server and client generate the same base world.
- Block types: grass, dirt, stone, wood (trunks), leaves, plank. 1 m cubes.
- Chunks of 16×16×16 (Uint8Array). Shared `VoxelWorld` (shared/src/voxel.ts):
  get/set, DDA raycast for block targeting, greedy cuboid merge per chunk for
  physics, RLE serialize + delta application.
- Falling off = void hazard (KILL_FLOOR below the lowest island) → respawn,
  same flow as the old sea.

## Build & destroy
- **Build tool slot**: B (or the mobile toggle button) swaps the gun for the
  build tool. LMB breaks the aimed block (instant, ≤6 m reach), RMB places
  one against the aimed face. B again (or Q) returns to the gun.
- **Mined = earned**: breaking adds the block to your stock (one shared stock,
  placed blocks are always plank-look), placing spends it. Spawn stock: 30.
  Stock rides the snapshot like ammo.
- Grenades blast craters: server removes blocks in a ~2.2 m radius sphere.
- Server-authoritative: clients send place/break INTENTS (reliable messages,
  not 60 Hz inputs); the server validates (reach, stock, occupancy, keep the
  world floor of protected spawn pads unbreakable) and broadcasts accepted
  edits as `{t:"block", x,y,z,b}` deltas. Late joiners receive the CURRENT
  world as RLE in the welcome.
- Physics rebuild: an edit re-merges only its chunk's cuboids on both server
  sim and client prediction mirror (same shared code).

## Rendering
- Per-chunk, per-block-type `InstancedMesh` of unit cubes; rebuilt on edit
  (chunk-local, cheap). Procedural 16×16 canvas textures (NearestFilter) for
  the Minecraft look — no external assets.
- Sky dome + sea stay as distant visuals far below the islands.

## Unchanged
- All combat, netcode, HUD, accounts, audio, mobile controls.
- Movement: 1 m blocks are climbed by jumping (jump height ~1.3 m).
- The MegaKit city + editor remain in the repo; `customMap.json` still
  overrides everything when present. The voxel world is the new DEFAULT map.
