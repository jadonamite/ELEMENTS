# The loop in Sindr: where it stands

Written 6 November 2026, after the pass that built the loop's trade, bank, notice board, night closure and shop ownership. `docs/GAME-LOOP.md` holds the plan and its build order; this file records what of it is actually in the game, how each piece is wired, and what is still missing.

## What a player can do now

In Sindr, on `main`:

- Fight a brawler, a robber, a bender or a husk; kill it and the loot falls where it died. Walk over it to claim it. Die and what you carried is left on the ground.
- Sell what you carry at a stall, buy from its shelves, and read the merchant's reason on any price.
- Bank coin at either counting house and walk away with a note the other house honours. Marked players are refused.
- Trade hand to hand with another player; trade offers arrive on the same context key as the stalls.
- Read the notice board outside the market: your own red flags, whether the watch has priced your head, and every open bounty with its reward.
- Find the stalls shuttered after dark. The prompt says so, and a trade attempted with a window already open is refused.
- Buy a stall whose keeper has gone broke, then take its takings and set a price multiplier per shelf.

## How each piece is wired

| Piece | Rule lives in | Endpoint | Window |
| --- | --- | --- | --- |
| Stalls, counting houses, notice board | `shared/src/net/places.ts` (one list, one reach) | — | — |
| Loot, purse, standing | `shared/src/economy/` | `/api/economy/loot`, `/death`, `/balance`, `/crime/*` | — |
| Trade and bank | `httpDoor`, `RoomDoor` in `client/src/economy/door.ts`; pricing and trade rules in `shared/src/economy/` | `/api/economy/merchants/buy`, `/merchants/sell`, `/counting-house/*`; over the zone room once online | `shop-window`, `counting-house-window` |
| Notice board | `fetchOpenBounties`, standing with `accountId` | `/api/economy/bounties`, `/crime/standing` | `notice-board-window` |
| Night closure | `stallsShut(nightness)` in `shared/src/net/clock.ts`, same `NIGHT_FROM = 0.45` as the robbers | — (decided in the browser) | `shop-window` refuses |
| Shop ownership | `shared/src/economy/shopOwnership.ts`, `server/src/economy/shopService.ts` | `/api/economy/shops/for-sale`, `/:id/ownership`, `/:id/buy`, `/:id/prices`, `/:id/withdraw`, `/:id/stock` | `shop-window` owner half |

Two rules were added to keep one source: the place list is checked against `client/src/world/sindr-anchors.json` by `client/tests/places.test.mjs`, and the market's closing darkness is the same constant the robbers use, checked by `shared/tests/clock.test.ts`.

## What is verified

- `npm run typecheck` is clean across all three workspaces.
- `npm test` passes: shared 99, server 83, client 102, no failures.
- The town boots in headless Chrome with the economy server running: canvas up, all four economy windows constructed and hidden, no exceptions, no failed economy calls.
- `GET /api/economy/shops/:id/ownership` answers 401 without a token, so a window cannot read ownership it has not earned.

Not verified, and why:

- Walking to the notice board and pressing the context key, and completing a shop purchase. All three Sindr merchants are open locally, so `for-sale` is empty and the sale panel cannot appear without a merchant first going broke over three days.
- Closure and ownership across two real accounts. Both need a signed-in session and a second player.

## Still open in the loop's build order

1. **The notice board is read-only.** Claiming a bounty means beating the player who holds it, which only happens online; the board shows the price and says who pays it.
2. **Night closure is decided in the browser.** The server has no authoritative zone clock: `shared/src/net/clock.ts` defines `ClockMsg` and nothing sends it, `ZoneRoom.now()` counts seconds since the room opened. One room-owned game minute, pushed to players, is what closure and the outlaws' night need before any of it can be trusted online.
3. **Stocking a shop has no window control.** `POST /api/economy/shops/:id/stock` works; only prices, takings and purchase are wired to the window.
4. **The forge and gear wear are out of scope until gear is an item.** Gear exists only inside a raid run's pack; `applyRaidLoss` adds wear and the pack is sold at the run's end. There is no persistent gear in the town satchel and no repair rule to charge for, so the Dim's forge has nothing to mend yet.
5. **The ledger room fast-forward** stays deferred to the end of the build, as `docs/GAME-LOOP.md` says.

## Housekeeping

- `main` is well ahead of `origin/main`; nothing from this pass is pushed.
- `deploy/play` holds the 180-player crowd, routing, dodge and Vercel configuration that `main` does not. It was left untouched.
- `workbench/` is untracked by design; the headless check used here is `workbench/tmp/check-town.mjs` and will not survive a clean clone.
