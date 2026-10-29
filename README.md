# ELEMENTS

ELEMENTS is a browser action RPG about four elemental nations. The browser client has a playable knight in a stone arena, with camera-relative movement and collision. A Colyseus server runs alongside it; multiplayer comes in later tasks.

## Run locally

Use Node.js 24 or newer and npm 11 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Select Play or click the arena to capture the mouse. Use WASD to move, Shift to run and the mouse to look around. Escape releases the mouse. You can also focus the arena with Tab and move using the keyboard. The knight turns toward movement and switches between idle, walk and run. The right-shoulder camera pulls in at walls and the floor. The game server listens on <http://127.0.0.1:2567> and registers an empty room named `empty`. Both services bind to this computer only. Press Ctrl+C to stop them.

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

All arena textures and the HDRI sky are from [Poly Haven](https://polyhaven.com/), released under the CC0 public domain license. No attribution is required, but sources are listed here per project rules.

- [stone_floor](https://polyhaven.com/a/stone_floor): arena floor diffuse, normal and ARM maps (1K JPG). `client/public/assets/textures/stone_floor_*.jpg`
- [castle_brick_07](https://polyhaven.com/a/castle_brick_07): arena wall diffuse, normal and ARM maps (1K JPG). `client/public/assets/textures/castle_brick_*.jpg`
- [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky): outdoor HDRI sky panorama for environment lighting and background (1K HDR). `client/public/assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr`

## Hero assets (Quaternius, CC0)

Character and weapon models are from the [LowPoly Animated Knight](https://quaternius.com/packs/animated-knight.html) pack by Quaternius ([OpenGameArt release](https://opengameart.org/content/lowpoly-animated-knight)), released under the Creative Commons CC0 Public Domain dedication.

- `client/public/assets/characters/hero.glb`: rigged humanoid knight model with dark iron armor and 12 animation clips (`idle`, `walk`, `run`, `attack_light`, `attack_heavy`, `dodge`, `jump`, `death`, and variants). Converted from the source FBX with [FBX2glTF](https://github.com/facebookincubator/FBX2glTF) (v0.9.7) and scaled to real size (1 unit = 1 metre, standing height 1.80 m).
- `client/public/assets/characters/sword.glb`: medieval arming sword mesh, attached to the right hand bone (`PalmR`) so it follows every animation and swing.
- `client/public/assets/characters/helmet.glb`: dark iron helmet mesh, attached to the head bone (`Head`).
