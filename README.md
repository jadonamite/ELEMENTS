# ELEMENTS

You buy a game called ELEMENTS, take it home and press play. The picture tears, the tear runs out of the screen into your room, and you're dragged through. Inside, you rise off the ground in the pause a game makes before it announces a level, and the world decides what you become. Most come down Lit, Shapers who bend one element and belong to its nation. Some come down Dim, the Hush, who can never bend but are the only ones who can craft. Nobody chooses, and there is one rising per account, forever.

You want to go home. Everyone you ask gives the same answer: only the Allborn, who commands all four elements, can open the way. So you follow the first rumour.

ELEMENTS is a third-person action RPG in the browser, set in a world of four nations under one tyrant. Its coin and every item in it live on NEAR, and a player never sees a wallet.

Play it at <https://elements.namite.xyz>.

## The world

Four nations sit around Chromara, the great city at the centre. IGNIS is a volcanic forge nation of black stone and ember-lit streets, at war with everyone and the most influential of the four. AQUES is a river delta of stilt houses and canals, where the world goes to be healed. TERRA is a canyon fortress cut into ochre cliffs, the richest nation after Chromara. AURA is high cliffs, wind towers and rope bridges, peaceable toward everybody.

Chromara holds the seat of the Edict, and whoever holds it is the Lord. The Lord before was benign and kept the peace, then vanished; the one who took the seat in the confusion is afraid of the nations and of a coup. So the Edict banished the old names of the elements, because names carry power and an unnamed element is weaker and harder to teach. Speak a banished name in the street and you earn a red flag. Whatever the names were holding has loosened, and monsters are what is left of it: elemental power with no name to hold it, taking the shape of local beasts.

The coin is CHROMA, the Lord's coin, stamped with an ear because the Lord is always listening. Fines and a share of trade go to the treasury, and the treasury never runs dry. The Dim are called lowborn, but they hold the economy, because every Lit fighter depends on them for gear and repairs.

The search for the Allborn is the spine of the campaign. Each nation's master holds one rumour about them, guarded by a nation boss. The rumours don't agree.

## What you play today

The whole nation of IGNIS is built as one walkable land of about 16 by 18 kilometres: volcanoes with lava running in their gullies, a crater lake with falls at its outlet, the sea and its coast, sulphur flats, the Slag Barrens, a gorge on the road to a border fort, pine and maple woods, terraced fields, and roads surveyed onto the land at cart grade with bends and switchbacks. At its heart is Sindr, the capital, a canal town with a market square, quays, terrace stairs and 180 townsfolk walking their own routes and speaking in recorded voices.

- **The opening.** An age check, a character creator with body presets, skin tone, hair style and hair colour, then the Drawing, where the world rolls your result: Hush 15%, or a Shaper of one of the four nations. You play straight away as a guest; you sign in with Google or email when you reach Sindr's gate, and everything you've done so far comes with you.
- **Your master.** The IGNIS master, Brandr, walks out to meet you, tells you about the Allborn, and gives you one fight to learn the controls before pointing you to town.
- **Fighting.** A sword with a three-hit light combo, two heavies, an uppercut, a ground pound, a dash strike, block and parry, a dodge that reads the attacker's line, and lock-on. A Shaper of IGNIS throws fire from burning hands, and a drawn blade carries it. Seven fighter tiers decide which moves you may use, up to the ultimate at tier five. Kills and landed ultimates get a close-up in slow motion.
- **Who you fight.** Robbers who come out bolder at night, army deserters on the roads, ember hounds and slag bulls in the wild lands, and street brawlers in Sindr who call you out, jeer, and call in their gang.
- **Loot.** Whoever wins a fight takes the loser's loot. It falls where they fell, in a chest with the nation's shimmer, and you walk over to claim it. Die and what you carried stays on the ground.
- **The market.** Fifteen shopkeepers trade in Sindr, each with a purse, a stock, a memory of you and a mind of its own. Sell, buy, talk to them, and read the reason behind every price. Stalls shut after dark.
- **Money and the law.** Two counting houses take your coin and give you a sealed note the other one honours, so you don't have to carry it through robber country. The watch fines red flags on sight; three at once become a bounty with your face on the notice board, and anyone who beats you collects it. Counting houses refuse marked players.
- **Owning a shop.** A keeper whose purse falls below 1,000 CHROMA stops buying and, after three days, shuts. A player can buy the shop, set a price on each shelf, stock it and take its takings.
- **Armour.** Buy it, wear it from your satchel, and the outfit changes on your body and stays on your account.

## Where it goes

The rest of the world is written in [docs/LORE.md](docs/LORE.md) and built nation by nation: AQUES, TERRA and AURA with their own masters, bosses and rumours; Chromara with its Sentries, guild halls and the sealed statue; the Hush's forge, where timing decides the quality of what you make; dungeon raids into ruins where the old names are still carved into the walls, opened only with keys the Dim craft; guilds and clans with shared halls and declared wars; land and houses on plots at the edge of each town; and a world boss with no name that rises near Chromara every few days and changes element as it fights, while the whole world chips at one health bar.

## Try it

These steps take about ten minutes on the live site. Use a private window so you start as a new player.

1. Open <https://elements.namite.xyz>. Pass the age check, make your character and do the Drawing.
2. Play the lesson with Brandr, then walk to Sindr's gate. A card titled "Keep your rising" appears. Sign in with Google or email.
3. Fight something on the road. When it falls, walk over the chest to claim the loot.
4. Stand at a stall in the market. Sell what you carried and buy something from the shelf. Each price comes with the keeper's reason.
5. Press "Talk to" at a stall and say something. The keeper answers in character and remembers you.
6. Within about a minute your trades settle on NEAR testnet. Open <https://elements-server-production.up.railway.app/api/chain> to see the last settled batch and its transaction, then follow the contract links below to see the same moves on the explorer.

## How the economy works

There are two NEAR contracts, both deployed on testnet under `elements-dev.testnet`:

| Contract | Standard | What it holds | Explorer |
|---|---|---|---|
| `chroma.elements-dev.testnet` | NEP-141 | CHROMA, the game's coin | [testnet.nearblocks.io](https://testnet.nearblocks.io/token/chroma.elements-dev.testnet) |
| `items-v3.elements-dev.testnet` | NEP-245 | Shards, potions, supplies, gear: one token id per item kind | [testnet.nearblocks.io](https://testnet.nearblocks.io/token/items-v3.elements-dev.testnet) |

**Every holder has a NEAR account.** Each player gets a NEAR implicit account. Its key is derived on the server from a secret and the player's id (`server/src/chain/accounts.ts`), so no per-player key is stored and the player never sees one. Places and townsfolk (the treasury, every shopkeeper, the masters, the counting houses, loot piles) get readable named accounts under the game account, such as `treasury.elements-dev.testnet` and `master-ignis.elements-dev.testnet`.

**The coin supply is fixed at the start.** CHROMA is minted once, in a genesis split from the server's ledger, and after that it only moves between holders. Coin comes into a player's purse from loot, sales and bounties, and leaves through purchases, fines and robbery. There is no way to buy CHROMA with money.

**The server plays, the chain settles.** The game server keeps a ledger of every coin and item move (`server/src/economy/ledgerService.ts`, `satchelService.ts`), so a fight or a sale never waits for a block. A settler (`server/src/chain/settler.ts`) sends the ledger to both contracts every 60 seconds in numbered batches. Each contract accepts only the next batch number, only from the owner, and refuses an overdraw, so a batch cannot be replayed, skipped or reordered. If the contract refuses a batch, the settler halts and reports it at `/api/chain` instead of retrying. Every move is logged as a standard NEP-141 or NEP-245 event, which is what the explorer reads.

**Shopkeepers set their own prices.** Fifteen keepers trade in Sindr. Each has its own purse and stock. A price follows the rule in `shared/src/economy/merchantRules.ts`: it rises as stock runs low, a colour of shard that floods the market gets cheaper, and a keeper charges more to a player who cheated it. The keeper's reason is written next to the price. A keeper whose purse falls below 1,000 CHROMA stops buying; after three days it shuts, and a player can buy the shop, set its prices and take its takings.

**Shopkeepers have minds, but the rules hold the money.** Each keeper plans its day (what to restock, what to ship as tribute, what to say) through a model router in `server/src/economy/agents/`. Plans are asked for a dozen keepers at a time, a few times a game day, from a pool of free model providers; the per-second trading decisions are made by fixed rules (`ruleDecider.ts`), with no model call. Once a game day, NEAR AI Cloud judges each keeper's day and gives it a directive. A model can propose a restock or a line to say, but the rule file decides what the purse can afford and what a price is. When no provider answers, the keepers fall back to written plans and lines.

**Players never notice the chain.** Sign-in is Google or email through Privy. The game shows a coin count and a satchel, not addresses or gas.

## Check a player's holdings

A signed-in player's own chain status is at `GET /api/chain/me` (send the session token as a bearer token). For each contract it returns the player's implicit account with its explorer link, the last settled batch and its transaction link, and how many moves are waiting. Anyone can read the public totals at `GET /api/chain`, which lists both contracts, the last batch number, its transaction link and anything waiting.

## Run it locally

You need Node.js 24 or newer and npm 11 or newer.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The game server listens on <http://127.0.0.1:2567>. With no chain settings the game plays fully off chain: the ledger still runs, and `/api/chain` reports both contracts as off chain. With no model keys the shopkeepers use their written plans and lines.

```sh
npm test          # shared, server and client test suites
npm run typecheck # every workspace
npm run build     # shared, server and client builds
```

On the submitted commit, typecheck is clean and the suites pass: shared 135, server 136, client 217.

The contracts are Rust, built with `near-sdk` 5.5:

```sh
cargo test --manifest-path contracts/chroma/Cargo.toml
cargo test --manifest-path contracts/items/Cargo.toml
cd contracts/items && cargo near build non-reproducible-wasm --no-abi
```

## Configuration

The server reads these environment variables. All are optional for local play.

| Variable | What it does |
|---|---|
| `PORT`, `HOST` | Where the server listens. |
| `ALLOWED_ORIGINS` | Browser origins allowed to call the API. |
| `ELEMENTS_DB_PATH` | Path to the SQLite database. |
| `ECONOMY_CLOCK_SPEED` | How fast the economy's day runs against real time. |
| `ELEMENTS_DEV_AUTH` | `1` enables a local sign-in for development. Ignored in production. |
| `ELEMENTS_CLIENT_KILLS` | Lets the browser report kills, for local testing. |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Privy sign-in. The client reads `VITE_PRIVY_APP_ID`. |
| `NEAR_NETWORK`, `NEAR_RPC_URL` | `testnet` (default) or `mainnet`, and an RPC override. |
| `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `CHROMA_CONTRACT_ID` | The game account, its key and the CHROMA contract. All three, plus `CHAIN_PLAYER_SECRET`, turn coin settlement on. |
| `ITEMS_CONTRACT_ID`, `ITEMS_PRIVATE_KEY` | The items contract and its settle-only key. |
| `CHAIN_PLAYER_SECRET` | The secret player accounts are derived from. |
| `CHAIN_SETTLE_MS`, `CHAIN_BATCH_SIZE` | Settlement interval (default 60000) and moves per batch (default 80). |
| `NEAR_AI_API_KEY`, `NEAR_AI_BASE_URL`, `NEAR_AI_MODEL` | NEAR AI Cloud for the daily judge. |
| `NVIDIA_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | The free model providers for keeper plans and talk. |
| `RAID_PORT`, `RAID_DB`, `RAID_DEV_AUTH` | The raid server. |

## Layout

- `client/`: the browser game, Vite, TypeScript and Three.js.
- `server/`: the game server (Colyseus and an HTTP API), the economy ledger, the keeper minds and the chain settler.
- `shared/`: rules both sides use: pricing, loot, the ledger checks, combat, the world data and `balance.json`.
- `contracts/chroma/`: the CHROMA NEP-141 contract.
- `contracts/items/`: the items NEP-245 contract, with transfer calls and refunds.
- `contracts/items-test-receiver/`: a receiver used to test transfer calls.
- `docs/`: game design, lore, the economy loop and asset records.

## Hackathon disclosure

All of this code was written after the hackathon was announced on 19 October 2026. The first commit, [`49f1806`](https://github.com/jadonamite/ELEMENTS/commit/49f1806), is dated 29 October 2026. There is no earlier code. The NEAR work starts at [`59ecd0b`](https://github.com/jadonamite/ELEMENTS/commit/59ecd0b) on 13 November (the CHROMA contract and settler); everything before it is the game itself, also built inside the window.

- The full history: [`49f1806...main`](https://github.com/jadonamite/ELEMENTS/compare/49f1806...main)
- The NEAR work only: [`59ecd0b~1...main`](https://github.com/jadonamite/ELEMENTS/compare/59ecd0b~1...main)

Libraries, art sources and AI tools are listed below and in [docs/ASSETS.md](docs/ASSETS.md). Much of the code was written with AI coding agents (Claude Code, Codex and Gemini) under a human lead, and some concept art and character sheets were generated with image models before being rebuilt as game assets.

## Libraries

Versions are pinned in each workspace's `package.json` and in `package-lock.json`.

- [Three.js](https://threejs.org/): rendering. [Rapier](https://rapier.rs/): physics and character movement.
- [Colyseus](https://docs.colyseus.io/): multiplayer rooms and state.
- [near-api-js](https://github.com/near/near-api-js) and [near-sdk-rs](https://github.com/near/near-sdk-rs): the settler and the contracts.
- [Privy](https://www.privy.io/): Google and email sign-in.
- [React](https://react.dev/): the sign-in panel only.
- [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [tsx](https://tsx.is/), [concurrently](https://github.com/open-cli-tools/concurrently): build and development.
- [Cinzel](https://github.com/NDISCOVER/Cinzel) and [Inter](https://github.com/rsms/inter): typefaces, self-hosted, SIL Open Font License 1.1.

Textures, models and animations come from Poly Haven (CC0), Quaternius (CC0), Mixamo and models made for the game. Each file's source is in [docs/ASSETS.md](docs/ASSETS.md).

## Legal

Terms, privacy and cookie policy are in `client/public/legal/` and linked from the game.
