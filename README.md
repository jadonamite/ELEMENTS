# ELEMENTS

ELEMENTS is a browser action RPG about four elemental nations. The browser client has a playable sword fighter in a round stone arena at dusk, with camera-relative movement and collision. A Colyseus server runs alongside it; multiplayer comes in later tasks.

## Run locally

Use Node.js 24 or newer and npm 11 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Select Enter the arena or click the arena to capture the mouse. Use WASD to move, Shift to run and the mouse to look around. Escape releases the mouse. You can also focus the arena with Tab and move using the keyboard. The fighter turns toward movement and switches between idle, walk and run. The right-shoulder camera pulls in at walls and the floor. Left click chains a three-hit light combo, right click two heavies; Q uppercut, E ground pound, F dash strike, hold R to block, Space to dodge. Out of a fight the fighter carries the sword on the back; attacking, blocking or a husk coming close draws it, and it goes back after a few quiet seconds. Three husks hunt you in the arena: one attacks at a time, every hit is checked by the blade touching the body and scored by the shared combat rules, and fallen husks are replaced. Add `?debug` to the address to show the frame rate. The game server listens on <http://127.0.0.1:2567> and registers an empty room named `empty`. Both services bind to this computer only. Press Ctrl+C to stop them.

```sh
npm test          # Shared balance, animation, movement and camera tests
npm run typecheck # Check all workspace TypeScript
npm run build     # Build shared code, server and browser client
npm start --workspace @elements/server # Run the built server
```

The client build is in `client/dist/`. The server build is in `server/dist/`.

## Folders

- `client/`: browser game, built with Vite and TypeScript.
- `server/`: Node.js multiplayer server, using Colyseus.
- `shared/`: shared rules and `balance.json` for arena dimensions, movement and camera tuning.
- `contracts/`: reserved for NEAR contracts in Rust.
- `art/game/`: finished assets for the game.
- `docs/`: game design and asset records.
- `workbench/`: local plans and working material, excluded from Git.

## Libraries and sources

Direct dependencies are pinned in the workspace manifests. `package-lock.json` records the installed dependency tree.

- [Three.js](https://threejs.org/): 3D rendering.
- [Rapier](https://rapier.rs/): arena collisions, kinematic character movement and camera shape sweeps.
- [Colyseus core](https://docs.colyseus.io/server), [WebSocket transport](https://docs.colyseus.io/server/transport/ws) and [schema](https://docs.colyseus.io/state): multiplayer server and state serialization.
- [Vite](https://vite.dev/): client development server and browser build.
- [TypeScript](https://www.typescriptlang.org/): type checking and compilation.
- [tsx](https://tsx.is/): runs server and test TypeScript during development.
- [concurrently](https://github.com/open-cli-tools/concurrently): starts and stops both development services.
- [Node.js](https://nodejs.org/): server runtime and shared-test runner.
- [Node.js types](https://www.npmjs.com/package/@types/node) and [Three.js types](https://www.npmjs.com/package/@types/three): TypeScript declarations from [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped).
- [Cinzel](https://github.com/NDISCOVER/Cinzel): display serif typeface by Natanael Gama, self-hosted WOFF2, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
- [Inter](https://github.com/rsms/inter): interface typeface by Rasmus Andersson, self-hosted WOFF2, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).

The client self-hosts its fonts locally under `client/public/fonts/`. Other asset sources are recorded in [docs/ASSETS.md](docs/ASSETS.md).

## Arena assets (Poly Haven, CC0)

All arena textures, models and the sky are from [Poly Haven](https://polyhaven.com/), released under the CC0 public domain license. Textures were converted to WebP and models packed to GLB with smaller textures and quantized meshes using [glTF-Transform](https://gltf-transform.dev/).

- [monastery_stone_floor](https://polyhaven.com/a/monastery_stone_floor): flagstone floor colour, normal and ARM maps (1K). `client/public/assets/textures/monastery_stone_floor_*.webp`
- [forest_ground_04](https://polyhaven.com/a/forest_ground_04): dirt worked into the floor and the ground beyond the wall (1K). `client/public/assets/textures/forest_ground_04_*.webp`
- [rock_wall_08](https://polyhaven.com/a/rock_wall_08): dry-stone ring wall (1K). `client/public/assets/textures/rock_wall_08_*.webp`
- [belfast_sunset_puresky](https://polyhaven.com/a/belfast_sunset_puresky): evening sky for lighting and background (1K HDR). `client/public/assets/hdri/belfast_sunset_puresky_1k.hdr`
- [gothic_statue](https://polyhaven.com/a/gothic_statue): the arena's statue landmark. `client/public/assets/props/gothic_statue.glb`
- [rock_face_01](https://polyhaven.com/a/rock_face_01) and [rock_face_02](https://polyhaven.com/a/rock_face_02): crags beyond the wall. `client/public/assets/props/rock_face_0*.glb`
- [rock_moss_set_01](https://polyhaven.com/a/rock_moss_set_01): standing stones beyond the wall. `client/public/assets/props/rock_moss_set_01.glb`
- [namaqualand_boulder_02](https://polyhaven.com/a/namaqualand_boulder_02): boulders inside the arena. `client/public/assets/props/namaqualand_boulder_02.glb`

## Hero assets (Quaternius, CC0)

- `client/public/assets/characters/hero.glb`: the mannequin and animations from Quaternius's [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (CC0), a realistically proportioned humanoid on a standard skeleton. The unused clips were removed, the kept ones renamed for the game (`idle`, `walk`, `run`, `sprint`, `attack_light`, `attack_heavy`, `dodge`, `hit`, `death`, `jump`, `cast` and others), and the mesh quantized with glTF-Transform. It is a stand-in until the game's own hero models are ready.
- `client/public/assets/characters/combat.glb`: ten sword moves (light combo of three, two heavies, uppercut, ground pound, dash strike, block, knockback) from Quaternius's Universal Animation Library 2 (CC0), animation only, trimmed and quantized with glTF-Transform. They play on the hero's skeleton by bone name.
- `client/public/assets/characters/enemy.glb`: husk clips (zombie idle, walk, run, scratch, bite, spawn and a knockback) from Quaternius's Universal Animation Library 2 (CC0), animation only, quantized with glTF-Transform. The husks use the hero's body with their own materials.
- `client/public/assets/characters/sword.glb`: arming sword from the [LowPoly Animated Knight](https://quaternius.com/packs/animated-knight.html) pack by Quaternius (CC0), attached to the right hand bone (`hand_r`) so it follows every animation.
