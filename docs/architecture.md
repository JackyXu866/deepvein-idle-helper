# Architecture

A high-level map for finding your way in the code. It names the parts and where the rules live; read the code for the details.

## Two halves: the page and the planning Worker

The userscript runs in the game page at `document-start`.

- **The page** (`src/main/bootstrap.js`) owns everything that touches the game. It wraps the game's WebSocket to read every frame and send commands. It also draws the panel, holds the cross-tab lease, saves the run to `sessionStorage` so a reload resumes it, and runs the update check.
- **The planning Worker** (`src/worker/`) does the heavy thinking off the page thread. It runs on a clone of the trainer's state and returns a proposed action plus the planner's runtime. The page applies a result only if the game state has not changed since it was taken (`planningGuard`). A result over 8 s is killed.

The game's own client code is never committed. `src/engine/` extracts the game's tick engine from the live client at runtime by name-independent fingerprints. It checks the engine, caches it per client build, and simulates routes with it in the Worker. Measured rates win over simulated ones, and simulated ones win over formulas.

## Layers

| Folder | Role |
|---|---|
| `main/` | Page entry and bootstrap: socket wrapper, panel, lease, run save/restore, Boss handoffs to the game's own join, update check |
| `runtime/` | `trainer.js`: the state machine that receives frames, sends one command at a time, waits for its confirmation and decides when to plan. Also `world-boss.js` (Boss rounds), `intents.js` (validation of every outgoing command), `telemetry.js` (measured rates), `hot-follow.js` |
| `worker/` | Planning Worker entry and `planning.js` (state cloning, guard, per-step timings) |
| `planner/` | All decisions: goals, recipes, supply chains, gear, enhancing, farming, housing, quests, consumables, mastery. `planner.js` builds the API and holds the planning itself (`plan`/`planTask`) |
| `economy/` | `market.js` (quotes, buying, selling, the market ledger), `economy.js` (maintenance: sales, enhancement, gear steps), `wiring.js` (planner ↔ market hooks) |
| `engine/` | Game engine extraction, simulation, mastery rules |
| `ui/` | Native-button helpers for the Boss, the Boss loot log, Chinese labels, update checker |
| `data/` | Built-in game data (`game-data.json`) and public tables |

## How one decision flows

1. A frame arrives. `trainer.receive` updates the player snapshot, confirms the pending command, and handles refusals: some are soft, some pause.
2. On a timer or a new snapshot, the page asks the Worker to plan, or plans inline when no Worker is available.
3. `trainer.advance` goes through the steps in a fixed order and issues the first one that has a command:
   - quest claims and rerolls, the fallback activity, mastery purchases;
   - the goal (chosen by the active strategy), house trips, pending market work;
   - maintenance: gear swaps and buys, enhancing and the mastery page, sales;
   - farming, consumables, and finally the goal's plan.
   Boss rounds are checked before ordinary waits.
4. `intents.js` validates the command, the page sends it, and the trainer waits for the snapshot that proves it happened.

## Shared rules and where they live

Each rule exists once; anything that needs it calls it.

- **Gold as time**: one gold rate, `planner.coinRate` (the top lasting row of `incomeRows`). `planner/gold.js` has the conversions and the payback test, `pays` (saved ≥ 1.2 × paid).
- **Make or buy**: `planner/input-cost.js` (`decide`, `producer`, `unitSeconds`, `make`). It prices inputs as time, credits XP in trained skills, and counts held stock at `planner.stockValue`.
- **What stock is worth**: `planner.stockValue` is the sale value when the helper sells that item (`market.sells`), else nothing.
- **Gear and enhancing**: `planner/investment.js` is the investment table. Every way to improve each slot (held, market, made, enhanced to +20, market +N copies) is priced on the same terms. The gear step, the enhancement step, gear projects and the panel all read it.
- **Enhancement odds and cost**: `enhanceQuote` and `enhanceTier` in `planner/inventory.js`. Mastery pages are in `planner/mastery-pages.js`: page 1 is for work, page 2 for enhancing only.
- **Selling**: `economy/market.js`. Prices follow the day's average (`dayPrice`, `listable`, `listingQuote`); each item sells at most once per 30 minutes; one sale fills every bid at the best price.
- **Quality**: `planner/quality.js` (recipes at a quality, holds, what is worth using).
- **Items, time and places**: `planner/items.js`. **Levels**: `planner/levels.js`.
- **补精通**: `planner/collection.js` ranks collection tiers and forge-log levels by gold per point. The prices come from `masteryPrice` and `forgeCandidates` in `planner.js`.
- **World Boss**: `runtime/world-boss.js` runs a round (set the task aside, walk, attack, resume). The page hands a round to the game's own join, either by clicking 加入 or on the Vein Blessing's `bossAutoJoin`.

## Conventions

- **One system per decision**: one rule and one acting path per decision. What the panel shows is what the helper does. Don't add a second rule for a special case; extend the shared one.
- Code comments say why, not what. Match the surrounding style: compact JS, Chinese text for anything the player sees.
- The game's client code is read from a local copy only, never committed.
- Changelog entries go in `CHANGELOG.md` only. Releases are described in the README's 开发 section.

## Testing and debugging

- `npm test` runs `node --test` over `test/`. `test/helpers.js` builds a planner on the real game data (`makePlanner`) and a player (`player`). Engine tests also need a local client copy: `DVI_CLIENT=path/to/index-XXXX.js npm test`.
- In the live game, `deepveinDebug()` in the console reports why the helper is or isn't acting: pending command, planning trace with per-step timings, recent commands, connection log. `window.deepvein.session.state` is the game's own copy of the character.
- To reproduce a live decision offline, copy the relevant parts of the state (skills, bank, equipment, masteries) into a script and run the planner on them with `makePlanner`.
