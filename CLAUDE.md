# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

"Dash City" currently contains **only 3D asset packs** — there is no source code, build system, game engine project, or test suite yet. When the user starts building the game, ask which engine/framework they want (e.g. Three.js, Godot, Unity) rather than assuming, then update this file with the resulting build/run commands and architecture.

## Assets

All assets are Kenney (kenney.nl) packs, licensed CC0 (public domain — free for commercial use, no attribution required):

- `kenney_car-kit/` — vehicles (ambulance, cars, debris pieces, cones, etc.)
- `kenney_city-kit-commercial_2.1/` — commercial buildings
- `kenney_city-kit-industrial_1.0/` — industrial buildings
- `kenney_city-kit-roads/` — road tiles/pieces
- `kenney_city-kit-suburban_20/` — suburban buildings
- `kenney_graveyard-kit_5.0/` — graveyard props
- `kenney_train-kit/` — trains/rails
- `kenney_watercraft-pack/` — boats/ships

Each pack follows the same layout:

```
kenney_<pack>/
├── Models/
│   ├── FBX format/
│   ├── GLB format/     ← preferred for web (Three.js/Babylon) use
│   ├── OBJ format/
│   └── Textures/
├── Previews/           ← per-model preview images (useful for picking assets)
├── Preview.png
└── License.txt
```

Model filenames are lowercase-kebab-case (e.g. `debris-door-window.glb`). Browse `Previews/` images to identify which model to use without loading them.
