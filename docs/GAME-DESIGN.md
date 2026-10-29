# ELEMENTS — Game Design Doc

Oct 28, 2026

## Overview

ELEMENTS is a lightweight browser action game: you "buy" the game, get pulled into a world you can't leave, and are drawn by lottery into one of four elemental nations. Fights feel weighty like God of War, and the world's economy is run by players and AI agents, not patches.

- **Hackathon:** NEAR Hackathon, primary track **Games With Real Economies** (`games`). Possible extra tags: Agent Economy, AI Swarms.
- **Judging rule for this track:** judged on the game loop, not the token. Bonus if players never notice the chain.
- **Inspiration, not a spinoff:** inspired by the genre of "trapped in a game world" stories and elemental martial arts. No names, characters, places or signature terms from existing franchises.
- **Timing:** per the hackathon's rule Q-001, the window runs from the 19 Oct announcement to 14 Nov, so code can start now. Work committed before 19 Oct is baseline; reused libraries and older code are listed in the README (Q-005). The submission deadline is 14 Nov, 23:59 UTC (00:59 on 15 Nov in Lagos).

## World and glossary

Four elemental nations surround the neutral city of Chromara, under a Lord whose **Edict of Unnaming** banished the old names of the elements. Every power is now known by a new name and by the colour of its light.

**The elements and their nations.** Each nation carries its element's name; the colour is its visual identity (effects, UI, flags, item tints).

| Element and nation | Colour | Beats | Loses to |
| --- | --- | --- | --- |
| IGNIS | Crimson | AURA | AQUES |
| AQUES (AH-kwes) | Azure | IGNIS | TERRA |
| TERRA | Ochre | AQUES | AURA |
| AURA | Pale white | TERRA | IGNIS |

**The people.** Official names are used by the court, quests and the UI; street names are what NPCs and players say.

| Group | Official | Street | Share at the Drawing | Role |
| --- | --- | --- | --- | --- |
| Born with an element | Shapers | the Lit | 85% | Fight; can merge crafted pieces |
| Born without | the Hush | the Dim (an insult) | 15% | The only crafters from raw materials |
| A Hush who awakens later | Vakna | — | 0.5% of the Hush, shrinking with population | Keeps crafting, gains an element, extra perks |
| Master of all four | the Allborn | the Prism | Not reachable at launch | Foreshadowed only |

**Places and money.**

- **Chromara:** the neutral central city. Main market, the Edict, the Lord's treasury, the world boss.
- **CHROMA:** the single currency, minted by the Lord's treasury in Chromara. Lore: the Lord is always listening, every coin is stamped with an ear, and Edict fines are paid in CHROMA. The ticker is free on NEAR (checked 29 Oct).
- **The Edict:** speaking a banished name in Chromara costs a fine in CHROMA, paid to the treasury. The game itself never uses the old franchise terms.

## Opening sequence

The first minute sells the game: a normal-looking purchase turns into being pulled into the world, then the Drawing decides who you are.

1. **Register** with social login. A NEAR account is created silently; the player never sees a wallet.
2. **"Buy" ELEMENTS.** Simulated, no real money. The player receives a game-copy token they own.
3. **Press Play.** The launcher glitches, the screen tears, and the player is pulled in.
4. **Wake in Chromara** and are led to **the Drawing**, the raffle ceremony.
5. **The result:** "You have awakened as a Shaper of IGNIS", or "You are Hush". The draw uses NEAR's on-chain randomness and is recorded permanently, so anyone can verify it.
6. **Sent to the home nation** the Drawing chose, and the game begins.

**Open:** how to stop re-rolls. Free accounts let people redraw, and bots could farm Hush accounts for the 0.5% awakening. Options: one game copy per verified identity, permanent results, and awakening that needs playtime plus burned CHROMA.

## Combat

Combat is the star of the game and gets most of the build time. It's player-versus-environment at launch; duels come later.

**Controls.** WASD to move, light attack, heavy attack, dodge, two element abilities and one ultimate. Deep enough to look like God of War, simple enough to need no manual.

**How each element feels in the hands.**

| Element | Style | Strength | Weakness |
| --- | --- | --- | --- |
| IGNIS | Aggressive bursts | Fast damage, combos | Fragile when caught |
| AQUES | Flowing, control | Healing, crowd control | Lower burst |
| TERRA | Slow and heavy, a tank | Armour, area hits | Slow movement |
| AURA | Fast and evasive | Mobility, dodges, range | Low armour |

**The counter cycle:** AQUES > IGNIS > AURA > TERRA > AQUES. Water douses fire, fire eats the air, wind wears down stone, earth dams water.

- **Soft counter:** about +25% damage, never a hard win. A skilled player can beat their counter.
- **Two neutral pairs** (AQUES vs AURA, IGNIS vs TERRA) are pure-skill matchups and make showcase duels.

**How the Hush fight:** with **relics**, weapons forged around captured elemental power. That keeps the Hush in combat and makes their crafting essential.

**Game feel, the God of War weight, built cheaply:**

- Hit-stop (a freeze of a few frames on impact) and camera shake
- Weighty animations with clear wind-ups (Mixamo motion capture)
- Shader-based elemental effects, cheap to render
- Slow motion on finishers, and a camera that pulls in close during fights

**Camera:** full 3D, high and angled like Hades for readability, pulling in close during fights.

## Economy

The economy is what this track scores: one currency (CHROMA) plus materials, with prices set by supply and demand and NPCs that can win or go broke. Value is in-game and tradable on-chain; there is no real-money wagering.

**Where CHROMA and materials come from:**

- Fights and zones drop **elemental shards**, tinted by colour.
- The Hush craft shards into relics and gear and sell them.
- Clearing zones and damaging the world boss pays out from the Lord's treasury.
- Mines on owned land produce their nation's shards over time.

**Where they leave the game** (the sinks that stop inflation):

- **Edict fines** for speaking a banished name in Chromara
- **Repairs:** gear wears down and the Hush repair it for a fee
- **Training:** NPC masters charge to teach techniques
- **Building upkeep** in CHROMA
- **Awakening attempts** burn CHROMA
- **Death:** you drop the materials you carry (never gear or your account), and part of them is destroyed

**Crafting rules:**

- Only the Hush craft from raw materials.
- Shapers can **merge** crafted pieces into stronger ones, but can't craft from raw.
- A **Vakna** keeps Hush crafting and gains an element, plus extra perks.

**What keeps it alive without a patch:**

- **Balance pricing.** Too many players farming one colour drives its shard price down and its counter's up.
- **Imbalance events.** If one colour dominates too long, the world reacts on its own, e.g. a Crimson firestorm that closes an Ochre trade route.
- **Interdependence.** 85% of players fight but can't craft; 15% craft. Every Shaper depends on the Hush.

**Awakening (Hush to Vakna):** a 0.5% base chance that **shrinks as the population grows**, so Vaknas stay rare at any scale. Each attempt **burns CHROMA**.

**Decided later:** who sets the treasury rules (fixed contract or player influence). To be settled as the build wraps up.

## Building and establishing

Land is a real on-chain asset: plots are NEP-245 tokens players own and can sell to each other, in limited supply per nation.

- **Plots** are bought with CHROMA in any nation. Your home nation is cheapest; owning land elsewhere costs a premium, which makes cross-nation trade plays possible.
- **Structures** on a simple grid:

| Structure | Who uses it | What it does |
| --- | --- | --- |
| Forge | Hush, Vakna | Craft relics and gear from raw shards |
| Dojo | Shapers | Train and advance mastery |
| Market stall | Anyone | Sell from your own shop instead of to NPC merchants |
| Shard mine | Owner | Produces the nation's shards over time |
| Walls and defenses | Owner | Protect the plot |

- **Upkeep:** every building costs CHROMA to maintain. Neglected buildings decay.
- **Guilds (lite at launch):** players can share a plot, pool CHROMA, and race for the world boss's final blow. Guild halls, politics and territory wars come later.

## World boss and NPC agents

The launch raid is one shared world boss near Chromara; real-time co-op raids come in a later version.

**The world boss:**

- **One shared health bar** for the whole world. Every player's fight chips at it.
- **Shifts element every few days**, so a different nation has the edge each phase. Counter-element gear prices spike on their own.
- **Rewards** from the treasury by damage contributed, plus a large bonus for the final blow, which guilds race for.
- **Returns stronger** after it falls, keeping the season going.
- **Open:** its name and lore. Idea: the thing the Lord banished the old names to contain.

**NPC agents.** Each has its own NEAR account, so its wealth and decisions are visible on-chain. Prices follow fixed rules; an AI model drives only dialogue and the rival guild's choices.

| NPC | Count at launch | Behaviour |
| --- | --- | --- |
| Merchants | 5 (one per nation, one in Chromara) | Hold CHROMA and stock, price by supply and demand, can go broke |
| Masters | 4 (one per element) | Train Shapers, raise fees when demand spikes |
| The Lord's Collectors | A few in Chromara | Enforce the Edict and collect fines for the treasury |
| Rival guild | 1 guild of AI agents | Fights the world boss and competes for the final-blow bonus |

## Progression and the Allborn path

Shapers grow in combat power, the Hush grow in economic power, and the Allborn is a legend that hints the game is bigger than launch.

- **Map:** the four nations surround Chromara. Each nation is a small zone; Chromara carries most of the content. The Drawing sets your home nation, but you can travel anywhere. Outsiders face higher prices and wary NPCs.
- **Shapers:** mastery tiers in their element (e.g. Novice, Adept, Master), unlocked by fighting and by paying NPC masters in CHROMA. Each tier unlocks new techniques.
- **The Hush:** craft tiers that unlock better relics and gear.
- **Vaknas:** both paths at once, their rarity making them the most valuable players in the economy.
- **The Allborn (the Prism):** not reachable at launch. Foreshadowed through legends in Chromara, a sealed statue and NPC whispers.

## Tech architecture

Everything real-time runs off-chain so the game stays light in the browser; NEAR holds only what players own and what has been decided.

```
┌─ Browser client ───────────────────────────────────────────────┐
│  Three.js + Rapier render · Combat input and effects ·         │
│  Social login, no wallet screen                                │
└────────────────────────────────────────────────────────────────┘
        ▲ │  inputs and live state, in real time
        │ ▼
┌─ Game server ──────────────────────────────────────────────────┐
│  Authoritative combat, world · Economy: prices, events ·       │
│  NPC agents: rules + AI talk                                   │
└────────────────────────────────────────────────────────────────┘
          │  ownership and outcomes only
          ▼
┌─ NEAR (on-chain) ──────────────────────────────────────────────┐
│  Game-copy token · The Drawing (randomness) ·                  │
│  Items, relics, plots (NEP-245) · CHROMA, treasury, fines ·       │
│  NPC agent accounts · Intents top-ups (optional)               │
└────────────────────────────────────────────────────────────────┘
```

Fights run on the game server in real time. The client signs in through social login and signs in-game actions in the background with NEAR function-call access keys, so players never see a transaction.

**Stack (proposed):**

- **Client:** Three.js or Babylon.js for rendering, Rapier for physics, shader-based effects.
- **Server:** Node with WebSockets for authoritative combat and world state.
- **Chain:** NEAR contracts for the game copy, the Drawing, NEP-245 items and plots, CHROMA and the treasury, and NPC agent accounts.
- **Assets:** Realistic pipeline: Megascans/Poly Haven scans, Hunyuan 3D characters, Mixamo/Rokoko animation, ElevenLabs audio and Marble/Scaniverse splats; see [docs/ASSETS.md](ASSETS.md) for verified rights, free-tier limits and unresolved blockers.

## Build plan and open questions

Code starts 1 Nov and combat comes first, because it decides the most work; everything ships by 14 Nov, 23:59 UTC (00:59 on 15 Nov in Lagos).

| Phase | Dates | Focus |
| --- | --- | --- |
| Foundations | 1–2 Nov | Engine setup, contracts |
| Combat core | 3–5 Nov | One element fully polished, the Drawing |
| World | 6–8 Nov | Four elements, nations, Chromara |
| Economy | 9–10 Nov | NPC agents, plots, prices |
| Boss, polish | 11–13 Nov | World boss, demo video, README |
| Ship | 14 Nov | Deploy, submit (deadline 23:59 UTC) |

**Team roles:**

- **Combat and engine:** controller, camera, the four movesets, effects, browser performance (60fps target on a mid-range laptop).
- **Chain and economy:** NEAR contracts, NPC agent wallets, pricing logic, the treasury.
- **World and UX:** the opening sequence, nation zones and Chromara, UI, the asset pipeline, audio, the demo video.

**Scope rule:** each nation is a small zone with its own moveset and colours, not a big map; Chromara carries most of the content.

**Before 1 Nov (design only, no code):**

- [ ] Ask the organizers in the NEAR Discord whether pre-1 Nov work is allowed if disclosed
- [ ] Pick the asset packs and confirm each license
- [x] Check that the CHROMA ticker is free on NEAR

**Open questions:**

- [ ] How strict is the anti-re-roll rule for the Drawing?
- [ ] The world boss's name and lore
- [ ] Who sets the treasury rules (decide as the build wraps up)
- [ ] Exact mastery and craft tier names
