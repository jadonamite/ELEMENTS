# ELEMENTS

ELEMENTS is a browser action RPG about four elemental nations. This scaffold runs an empty Three.js scene and a Colyseus server; gameplay comes in later tasks.

## Run locally

Use Node.js 24 or newer and npm 11 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The page is a dark canvas. The game server listens on <http://127.0.0.1:2567> and registers an empty room named `empty`. Both services bind to this computer only. Press Ctrl+C to stop them.

```sh
npm test          # Shared balance-data test
npm run typecheck # Check all workspace TypeScript
npm run build     # Build shared code, server and browser client
npm start --workspace @elements/server # Run the built server
```

The client build is in `client/dist/`. The server build is in `server/dist/`.

## Folders

- `client/`: browser game, built with Vite and TypeScript.
- `server/`: Node.js multiplayer server, using Colyseus.
- `shared/`: shared rules and `balance.json`, currently empty.
- `contracts/`: reserved for NEAR contracts in Rust.
- `art/game/`: finished assets for the game.
- `docs/`: game design and asset records.
- `workbench/`: local plans and working material, excluded from Git.

## Libraries and sources

Direct dependencies are pinned in the workspace manifests. `package-lock.json` records the installed dependency tree.

- [Three.js](https://threejs.org/): 3D rendering.
- [Rapier](https://rapier.rs/): physics library, installed for the arena task.
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
