# ELEMENTS: the game loop (draft 1, 1 Nov 2026)

Nothing in the original plan is cut or reduced. `docs/LORE.md` and `docs/GAME-DESIGN.md` still hold the whole game. This file does two things: it writes the loop on paper (what a player does every 30 seconds, every 5 minutes, every session), and it sets the build order so that loop is playable early, inside the real game, in Sindr.

The track (NEAR Hackathon, Games With Real Economies) asks for exactly what our economy plan already has: NPC merchants that are agents with wallets, player-owned markets, an economy that moves without a patch, items as NEP-245 tokens, social login with no wallet screens, a readable price file with the merchant's reasoning shown, and a fast-forward view of a week of trading. Sources: `nearhackathon.com/HACKATHON.md`, `near-hackathon-prompt-examples/tracks/09-games.md` (read 1 Nov).

## 1. The loop

### Every 30 seconds
- **Lit (Shaper):** walk Sindr or the road, fight. A robber, a deserter, an ember hound. The fight is the God of War-weight fight we have: weapon, hands, legs, bending, parry, combos. The winner takes the loser's loot: villains drop mostly the CHROMA they carried; monsters drop shards of their nation's colour (40% chance of 1 in a nation zone). Loot drops onto the ground where the enemy falls; the player must walk over it to claim it (it is never vacuumed automatically into satchels). The pack fills and the player feels the weight of carrying it, because robbers target players who carry too much, and dying drops the materials you carried where you fell.
- **Dim (Hush):** buy or win raw shards, work the forge. The forging mini-game, where timing decides quality. Repair a Lit player's worn gear for coin. Run errands at the Raid Hall branch for a cut.
- **Both:** see the world react. A merchant's price tag changes after you sell to them. A shop's purse visibly shrinks. A Sentry or guard notices how much you carry.

### Every 5 minutes
- **Sell and buy at the market.** Each merchant in Sindr's market square is an agent with its own wallet (a visible purse), its own stock and its own memory of you. Its price follows the readable rule in one file: `price = base x (1 + 2 x (1 - stock / max stock)) x colour modifier`, plus the 48-hour balance rule (a colour over 40% of sales sells 20% cheaper; its counter colour 20% dearer), plus NPC memory (cheat it and it charges you more). Flood the market with Crimson shards and Crimson gets cheap. Hover a price to read the merchant's reasoning in its own words: "I bought 40 Crimson shards this hour and the Lord's tribute cart left yesterday; I pay less now."
- **Bank before you travel.** Carry coin to one of Sindr's two counting houses and get a sealed note any counting house honours. Marked players (a red flag or a bounty) are refused. Going out the east gate with a full pack is a choice; the Gorge Road robbers know it.
- **Spend.** Potions (drinking leaves you open in a fight), gear (stats, rarity, wear 20 a day, breaks after five), training fees to the master, repairs from a Dim.
- **Trade with players.** Hand to hand anywhere; Lit-to-Lit trades are taxed far more than trades with a Dim, so trade runs through the Dim.

### Every session
- **A merchant goes broke and shuts.** Under 1,000 CHROMA it stops buying; after three days it closes. A player can buy the shop and run it: set its prices, stock it, take its profit. That is the player-owned market in Sindr, before land and stalls arrive. If nobody buys it, a new NPC merchant arrives with a purse from the treasury.
- **Climb a tier.** Lit: enough fights, pay the master, win the trial. Dim: enough crafting, pay a master smith, pass a test piece.
- **Crime and its cost.** Rob a player for their pack and take a red flag; three at once become a bounty with your face on the notice board; anyone who beats you collects it; jail takes 40% of coin, materials and gear.
- **Follow a lead.** The master's hint, the forged relic, the road to Chromara. Between leads, the world is open.

### For judges and for us: the fast-forward
*(Deferred to the end of the entire build; not built now.)*
A room in the counting house (the ledger room) where the clerk shows the town's books. One control runs Sindr's economy forward a week in a minute: 100 simulated players fight, sell, craft and bank; prices move on the board; a merchant's purse drains and its shutters close; a player buys it. It runs the real rules (the 60-day economy simulation already does this offline). Every number on screen is the ledger's, and each purse links to its account on the NEAR explorer for anyone who wants to look. Players who don't care never see the chain. Observed and integrated towards the end of the entire build after the main game is complete.

## 2. Who the agents are

| Agent | Wallet | What it decides | Within what limits |
| --- | --- | --- | --- |
| Market merchants (3 in Sindr to start: shards and materials, potions and supplies, arms and armour) | Own NEAR account, visible purse | What to restock and when, how much tribute to ship, what to say to you, its reasoning line | Can never break the price rule or the purse; an AI model (NEAR AI Cloud) proposes, the rule file checks |
| Master of IGNIS | Own account | Training fees (+10% a week while students rise, down when they fall) | Fee rule in the same file |
| Master smith (for the Dim) | Own account | Test-piece fees, which commissions to post | Same |
| The treasury (the Lord) | Own account | Pays bounties on monsters, takes fines, taxes, tribute | Never runs dry; the economy favours the Lord |
| Sentries and guards | Own accounts | Fines on sight | Fines from the rule file |
| The rival clan (later, M11.4) | Own accounts | Plays like players: buys cheap shards, races for the boss | As in the plan |

## 3. What runs on NEAR

| Piece | On chain | What the player sees |
| --- | --- | --- |
| Login | Privy social login makes a NEAR account silently; in-game actions are signed in the background with function-call access keys | "Sign in with Google" |
| CHROMA | NEP-141 coin (contract built); earned only by playing, never bought or cashed out | A coin count |
| Shards, materials, gear, relics, keys, later plots and the game copy | One NEP-245 multi-token contract, every item type in it | An inventory |
| NPC purses | Each agent's own account | A shop's purse, a clerk's ledger |
| Settling | The server's ledger is the truth; it settles to chain every 10 minutes and on every trade or withdrawal; players never wait | Nothing |
| NEAR Intents | Merchants act as solvers on player market orders ("sell 8 Crimson shards for at least 90"; the merchant whose quote beats it fills it), as the economy design planned. Intents has no testnet (hackathon rule Q-007): mainnet, dev accounts, tiny amounts, `dry: true` quotes | A sell order that gets filled |

## 4. Build order from here

Nothing is removed from the build plan; the economy items move up and run in parallel with the town. Milestone numbers (M3.8, M5.2 ...) refer to the build plan.

1. **Town (running now):** Sindr on levels with stairs and walls, the maze style reworked, the look raised toward the bar. The market square, counting houses, forge and master's hall are where the loop happens, so they come first and to the full look.
2. **The loop in Sindr, playable (new position, straight after the town's core):**
   - loot drops in the world (player walks over to claim, not auto-vacuumed) and the pack (M5.2), dying drops what you carried (M3.8);
   - merchants in the square with purses, stock, the price file, reasoning tooltips, NPC memory (M5.3, M5.11), and the AI agent deciding restock and words;
   - counting houses open (M5.4), red flags, bounties, notice board (M5.5, M5.6);
   - shards from monsters (M7.3) with the ember hound (M1.11), the forge mini-game for the Dim (M7.4), wear and repair (M7.5);
   - a broke merchant's shop that a player can buy;
   - shops shut at night (M3.7).
   *(Note: The ledger room fast-forward is left for the end of the entire build).*
3. **On chain, alongside:** the economy server and coin contract merged, NEP-245 contract, agent accounts, settling (M6.1, M6.3, M6.4), then Intents with merchants as solvers.
4. **Then the rest of M3 as planned:** Gorge Road and ambushes, preset arenas, Slag Barrens, the fort. Then M4 onward, unchanged.

## 5. Open questions

1. Does the 30-second / 5-minute / session loop above match the game in your head? Anything missing or wrong for the Lit or the Dim?
2. Three merchants in Sindr's square to start (shards and materials; potions and supplies; arms and armour): right split?
3. The ledger room inside the counting house as the place for the fast-forward: right place, or somewhere else (the master's hall, a notice board)?
4. Intents: merchants as solvers on player market orders, as planned. Also use it for buying the game in the opening shop (pay with any token from any chain)? Both need mainnet with tiny amounts.
5. Gathering: the lore gets shards from monsters only. The track's example has players gathering materials. Keep monsters only, or add a second source (ore at the slag vents for the Dim)?
