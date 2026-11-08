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

## Module index

Every file under `src/` and what it owns. Before writing logic, find the module that already owns it. A new module gets a line here.

**`main/`**
- `entry.js`: the userscript entry; loads the bootstrap.
- `bootstrap.js`: page side: the socket wrapper, command sending, panel and settings, lease, run save/restore, Boss handoffs (the 加入 click, the Vein Blessing's `bossAutoJoin`), `deepveinDebug()`.

**`runtime/`**
- `trainer.js`: the state machine: receives frames, confirms or refuses the pending command, decides the next step (`advance`, `runMastery`), pauses and resumes.
- `intents.js`: validation of every outgoing command (`validateIntent`).
- `world-boss.js`: a World Boss round from spawn to resume; the native join capture.
- `automation-policy.js`: the Boss time window, the skip chance per round, harvest timing.
- `telemetry.js`: measured rates per route from the game's receipts.
- `hot-follow.js`: the hot-skill schedule and following it.
- `util.js`: small shared helpers for the runtime (copy, same, wait/action).

**`worker/`**
- `entry.js`, `source.js`: the planning Worker and its embedded source.
- `planning.js`: what crosses between page and Worker, the guard that drops stale results, per-step timings.

**`planner/`**: decisions
- `planner.js`: builds the planner API; goal planning (`plan`/`planTask`), supply (`need`, `batch`), fights, the gold rate (`incomeRows`, `coinRate`), gear targets, 补精通 prices (`masteryPrice`, `forgeCandidates`, `masteryForge`).
- `strategy.js`: candidate rating, the route estimate, calibration, the one switch margin (`outscores`).
- `progression.js`: 自主发展 projects and the level band.
- `specialization.js`: 主业经营 and income choices.
- `quests.js`: dailies and weeklies, rerolls. `perks.js`: quest-point perks.
- `collection.js`: 补精通: collection tiers and forge-log levels, ranked by gold per point.
- `mastery-pages.js`: the two mastery pages, enhance odds, the page switch. `mastery-plan.js`: where mastery points go (`allocate`, and the objective for the goal).
- `house-bonus.js`: what placed house rooms add (speed, damage, rare-find).
- `investment.js`: the investment table (every way to improve each slot); enhancement expected cost; funding.
- `mounts.js`: the merchant's horse, breeding (ten of a quality into one of the next), the price of a mount of any quality (`mountSupply`) and the step that acts on it (`mountSupplyStep`).
- `enhancement.js`: the enhancing step (`planEnhancement`) and the guard against resending an attempt.
- `gear.js`: slots, what fits, how long a piece is used. `professions.js`: combat professions, weapons, wear requirements.
- `rates.js`: game-formula inputs for a job or a fight, and `qualityGain` (gold the rarer drops add). `estimates.js`: base work and combat estimates from the formulas. `rarity.js`: the quality roll factor.
- `input-cost.js`: make or buy: the cheapest way to get an input, as time.
- `crafting.js`: what can be made from held stock; batch boundaries (`finishTaskReason`).
- `inventory.js`: budgets and reserves (`inventoryBudget`, `coinReserve`), the sale review, enhancement quotes and tiers, what a quality item is worth to a levelling plan. A goal a quest interrupts keeps its reserve through `waitingGoals` (`reserveWaitingGoals`): a stage preparation or gear project under its skill, a funding goal under `funding` until its gold is met or its hour is up.
- `quality.js`: every quality rule (recipes at a quality, holds, what is worth using, sale ratios).
- `gold.js`: gold as time, the payback test.
- `items.js`: item ids, stock, pack, map, prices. `levels.js`: the level curve. `keys.js`: measurement keys.
- `supplies.js`: potions and food: effects, combat supplies. `consumables.js`: when to drink or eat.
- `farming.js`: crops, harvest yields, herb and crop reserves. `housing.js`: house plots, rooms, fuel, trips home.
- `fallback.js`: the game's own fallback activity.
- `plan-view.js`: the 计划 tab's data (it reads the decisions, never recomputes them).
- `result.js`: the decision result shape (`action`, `waiting`).

**`economy/`**
- `market.js`: quotes and the price feed, buying, selling (day-average pricing, batching), the market ledger, the closed-market rule, whether stock is ever sold (`sells`).
- `market-history.js`: several days of prices and trades per item.
- `economy.js`: maintenance at task boundaries: the gear step, enhancing and the page switch, sales and deposits.
- `wiring.js`: connects the planner's market hooks, alike on the page and in the Worker.

**`engine/`**
- `extract.js`, `analyze.js`, `fingerprints.js`, `prepare.js`: find and extract the game's tick engine from the live client.
- `runtime.js`: load, smoke-test and run the engine; simulated rates.
- `mastery-rules.js`: mastery costs, limits, effect per rank, which skills gather speed serves.

**`ui/`**
- `boss-join.js`: the game's own Boss join and leave controls. `boss-loot.js`: the Boss loot log in chat.
- `labels-zh.js`: Chinese names from the game's dictionary. `stay-active.js`: keeps a hidden tab from being marked away.
- `update-checker.js`: the in-panel update check.

**`data/`**: `game-data.json` (built-in game data), `game-data.js` (loader), `public-tables.js` (reading and checking the live client's public tables). **`vendor/`**: `acorn.js` (JS parser for the engine extraction). **`version.js`**: version, build time, release repo and branch.

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

## Unified modules (required)

Every rule and every decision lives in exactly one module, and every feature that needs it calls that module. This is not a style preference: two copies of a rule drift apart, and then the panel says one thing while the helper does another, or two features act differently on the same case.

- **Reuse first.** Before writing logic, look it up in the registry below. If the rule is there, call it, even when the call is less convenient than a local shortcut.
- **Extend, don't fork.** When a feature needs a case the shared rule lacks, add the case to the shared module so every caller gets it. Never add a second rule or a special case beside it.
- **New shared rules go in the registry.** A rule used by more than one feature gets its own home and a line below.
- **Shown = done.** The panel, the reasons and the logs read the same function the action uses, never a re-computation of it.
- **Test the agreement.** A change to a shared rule gets a test, and where a panel shows a decision, a test that what is shown is what is done.

## Shared rules and where they live

The registry: each rule exists here once; anything that needs it calls it.

- **Gold as time**: one gold rate, `planner.coinRate` (the top lasting row of `incomeRows`). `planner/gold.js` has the conversions and the payback test, `pays` (saved ≥ 1.2 × paid).
- **Make or buy**: `planner/input-cost.js` (`decide`, `producer`, `unitSeconds`, `make`). It prices inputs as time, credits XP in trained skills, and counts held stock at `planner.stockValue`.
- **What an item is worth**: one price, `market.unitValue` (`planner.saleValue`): what the sale rule itself gets for it after tax, i.e. the day's traded price it lists at, or a buy order that pays more, never below the merchant or the town buyback. `planner.stockValue` is that price for any item that can be sold at all (`planner.stockSold` = `market.saleable`), whatever the sale settings; only unsellable items cost nothing to use. Using, burning as house fuel, handing in and selling are all weighed at it. A route's held inputs are priced by one function, `planner.ownedGold(p, estimate)`.
- **Collection targets**: `masteryCandidates` in `planner/collection.js` lists every collection's next tier, unstarted ones included (the first item pays: client `rP`).
- **Gear and enhancing**: `planner/investment.js` is the investment table. Every way to improve each slot is one route on the same terms: a starting piece (the worn one, one held, or one to get: made with inputs held, gathered or bought, bought at +0 or as an enhanced copy, a mount also bred or from the merchant; every quality up to legendary) and then enhancing it to its best +k (k = its own +N: as it is). Its cost is getting the start plus the expected enhancing; each start keeps its best k. A legendary piece made from legendary materials (`manualCraft`) is priced the same but is never a pick: when it would save the most it is shown as advice (`advice`), labelled 手动制作 only, since legendary materials are the player's. A copy already worn or held is never got again: no start that has to be made, bought or bred runs on a line (piece and quality) already owned at its +N or higher. The gear step buys a picked start on the market (whole route affordable), the gear project makes it, `mountSupplyStep` breeds or buys a mount at the merchant; a held start is enhanced in the bank by the enhancing step and put on once it beats the worn piece. The gear step, the enhancement step, gear projects and the panel all read it. Pieces are compared by one index, `worth`: the XP rate times (1 + the gold their luck adds at the gold rate, `luckGold` in `rates.js`). An amulet's luck counts across the account's measured work and its whole time; a tool's quality luck counts in its job.
- **Mounts**: `planner/mounts.js`. `mountSupply` prices a mount of any quality (+0) the cheapest way at each step: held lower mounts in the bank (lowest +N first, at `stockValue`), the market's ask, the merchant's Horse (2 × base value, total level ≥ 150; it wins a tie), or ten of the quality below, bred. `acquire` in the investment table uses it, as a mount's way to get its starting piece in the table's one route (see Gear and enhancing). `mountSupplyStep` acts on it (vendorBuy, marketBuy, `breedMounts`). Legendary gear may be bought to wear (`buyableItem` in `quality.js`), never sold or used up.
- **Funding an improvement**: `fundingGoal` in `planner/investment.js` is the one way gold is earned for a worthwhile improvement the account cannot yet afford. Each slot's pick (by net) queues by return per gold (`byReturn` in `gold.js`: most saved per unit paid first); the queue's head is funded, nothing past it while the head is affordable, and the gear step buys in the same order (its own goal on the gold job until affordable; every hour the goal is chosen afresh, so it goes on only while the improvement is still worth it at the latest prices). A task's cash budget holds only that task's own needs; nothing else rides on it (`dropEnhancementGold` in `inventory.js` clears what older builds saved there).
- **Enhancement odds and cost**: `enhanceQuote` and `enhanceTier` in `planner/inventory.js`. Mastery pages are in `planner/mastery-pages.js`: page 1 is for work, page 2 for enhancing only. `pageStep` is the one switch; since client 1.0.1213 switching has no cooldown, and the game only suggests the better page, never switching itself.
- **Selling**: `economy/market.js`. One market price per item, `marketPrice` (the feed's 7-day average, else the week's watched trades, never above the game shop's price: `shopPrice` in `planner/items.js`, the one shop list that housing's house-nothing exclusion also reads; nor more than twice off the quantity-weighted median of the week's trades a book showed, `tradeMedian` in `economy/market-history.js`, which then replaces it: a freak trade cannot set it; a median holds for a day, and a listing's review reads its book once when no current median is known; a full history makes room for a book read by dropping the id seen longest ago), used by `listingQuote`, `fairBid`, `equipmentOffer` and `unitValue`. A listing goes one step under the lowest ask within [90%, 115%] of it (the 90% floor, `fairFloor`, is dropped once more units are offered under it than a day's turnover: those asks are the market, and the same floor decides re-listing and quality/gear offers), sized by `listSize` (a tenth of a day's turnover, `dailyTurnover`); it is re-listed only when `undercut` or above the 115% ceiling (gear and quality offers keep the same ceiling). A bid is filled within 3% of it. The merchant only when there is no market price (profit output, a full bank, a batch the buyback left). Each item sells at most once per review (`reviewMs`, three hours: the one cadence for re-pricing, merging and giving up a slot); one sale fills every bid at the best price. Sell listings may take every game order slot but one, kept for a purchase (`slots`). When they are full, a slot goes to what sells for most in a day (`dayValue`: price on what the market takes of it in a day, at most what it holds): a waiting sale worth twice the weakest of the helper's own listings past their review takes that listing's slot (`slotFor`); the player's orders and held buyback listings stay. One order per item (`merged`): a second own order of an item is taken back, and a listing sold down under two thirds of what one listing would now hold is taken back after its review and listed again with the new surplus; a re-listing takes the new surplus along. What the current batch uses is kept until it ends; what it makes is too only when the route has a limit, so an endless funding or leveling route sells its output as it comes (`reviewInventory`).
- **Quality**: `planner/quality.js` (recipes at a quality, holds, what is worth using).
- **Rare-find odds**: `planner/rarity.js` `rarityFactor` is the game's quality roll factor: (1 + amulet and tool luck) × (1 + hunter brew, Vein Blessing, rare-find mastery, lucky shrine). Work and combat estimates, drop timing, and the worth of a hunter brew or a rare-find rank (`qualityGain` in `planner/rates.js`) all use it.
- **Items, time and places**: `planner/items.js`. **Levels**: `planner/levels.js`.
- **补精通**: `planner/collection.js` ranks collection tiers and forge-log levels by gold per point. The prices come from `masteryPrice` and `forgeCandidates` in `planner.js`.
- **Mastery points**: `planner/mastery-plan.js`. Each purchase is the best allocation of the available points for the goal's objective, priced by the same rules that pick the work: 补精通 by `masteryPrice` on its next targets, an income goal by `goldRate`, leveling by the measured routes' time. Page 2 takes enhance ranks only. A reset (`resetCost`: 50,000 × 2^resets) is advised, never done (the user's call), when allocating every earned point afresh earns over the goal's horizon (a week for 补精通 or a main trade, a day for a leveling goal; `objective().gold`) at least 1.2× its price (`resetCheck`, weighed once an hour per account and kind of goal, a 150 ms slice per planning run kept in module scope since the worker builds a new planner each run → `resetAdvice`, logged every six hours and shown on the plan page).
- **Work and combat speed**: `workEstimate`/`combatEstimate` in `planner/estimates.js` with inputs from `planner/rates.js`: level, tool, quick perk plus house room, gather or craft mastery; max hit with house damage and max-hit mastery, accuracy with accuracy mastery. House bonuses: `planner/house-bonus.js`. Changing what the formula covers bumps `FORMULA_VERSION` (strategy.js) so learnt efficiencies are relearnt.
- **Quests (every mode)**: `planner/quests.js` `chooseGoal` picks the daily, then the weekly, to do; `completed`/`claim`/`reroll` likewise. In the trainer, `questOver` ends a quest goal (done, or past its horizon) in every mode; 补精通 and assist take one over through `questTurn` and run it with `runGoal`. In assist, `keepPlayerWork` does what the game's "keep my task" does: before a quest route replaces the player's route it sends `setAside` (their work goes to the front of their queue), and the quest itself starts with the game's `goQuest`, after which the game carries on with the queue; a quest dropped while the work is set aside sends `startQueued`. `drives()` says whether the helper is driving the character (every mode but assist); `acting()` adds an assist quest.
- **Potions**: `planner/consumables.js` `planConsumable` drinks for the work under way (the next command, else the route), whatever is queued behind it.
- **Trading desk** (income without the character's time): `market.js` `tradeRows`/`trade`. Resale (`flip`) and buy-enhance-resell (`enhance`, `expectedEnhancement`) opportunities from the price feed, judged at the one market price with resale at 95% of it after tax, only on liquid items (`MIN_WEEK_VOLUME`), never at margins over 5x (`tradeAnomalies`, shown only), a flip only when no seller would be left under its resale floor. Buys wait for a natural stop; open trades use at most half the purchase allowance, a fifth each; goods are listed by the selling rules (`profitSale`, so everyday selling off does not hold them). Open trades: `state.trades`.
- **House points per item**: `housing.housePointsOf`, a port of the client's rule: a raw material's tier in its family; secondary sources (seeds no shop sells → their crop's tier, the rough gem → stone, cloth bolts → hide 1/3/5/7); a crafted item the tiers of its raw inputs × min(2.5, 1 + 0.6 × depth), counting secondary sources only when no input reaches a raw material; ×3 per quality; nothing for shop items, fireworks or enhanced items.
- **Sell or burn**: `housing.fuelHold` lists the fuel the next worthwhile upgrade of each facility would burn (the cheapest points at the one sale value, the next level of one already upgrading included); `economy.keepHouseFuel` keeps it from sale, in maintenance and in the sale list shown. What cannot be sold at all is worth 0 to give up (`market.saleable`, read through `planner.stockValue`). That covers quality gear and rare goods with no market price in a fresh price feed, since they never go to the merchant. Housing burns that surplus into stored points: on any visit home, or on a trip of its own from `FREE_FUEL_TRIP` kinds or when the bank is nearly full.
- **Town orders**: `planner/town-orders.js`. `townOrders(data, day)` is the client's draw (the same three orders for everyone); an order is taken when its pay beats making it by the payback rule (gold as time, held stock at `stockValue`). It runs as a quest-shaped goal (`quest.period === 'order'`) through the quests' goal path: `questChooseGoal` gives mandatory quests first, then the best worthwhile order (none in assist). `planAtBoundary` hands the pieces in (`contract`) once they are in the bank. The delivered slots come from the welcome frame and the `contracts` message (`player.contracts`).
- **World Boss**: `runtime/world-boss.js` runs a round (set the task aside, walk, attack, resume). The page hands a round to the game's own join, either by clicking 加入 or on the Vein Blessing's `bossAutoJoin`.
- **Errors**: `runtime/trainer.js`. A server refusal of the helper's own command syncs and replans (`checkCommand`). One with no rule of its own sets its work aside for five minutes: the house work, or else the current goal. Repeated failures (`fault`) pause. A refusal of something the helper did not send is only logged. Every error pause (`pauseError`) restarts by itself after 2, 5, 10, 20, then 30 minutes (`retryAfterError`, called from the page's pump), and a pause by hand cancels it.

## Conventions

- Unified modules, above, come before everything else here.
- Code comments say why, not what. Match the surrounding style: compact JS, Chinese text for anything the player sees.
- The game's client code is read from a local copy only, never committed.
- Changelog entries go in `CHANGELOG.md` only. Releases are described in the README's 开发 section.

## Testing and debugging

- `npm test` runs `node --test` over `test/`. `test/helpers.js` builds a planner on the real game data (`makePlanner`) and a player (`player`). Engine tests also need a local client copy: `DVI_CLIENT=path/to/index-XXXX.js npm test`.
- In the live game, `deepveinDebug()` in the console reports why the helper is or isn't acting: pending command, planning trace with per-step timings, recent commands, connection log. `window.deepvein.session.state` is the game's own copy of the character.
- To reproduce a live decision offline, copy the relevant parts of the state (skills, bank, equipment, masteries) into a script and run the planner on them with `makePlanner`.
