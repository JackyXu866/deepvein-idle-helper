# Roadmap: modular rewrite

The `src/` tree is a mechanical split of v0.7.17 with no behavior change; `npm run build` regenerates the published userscripts. Everything below is planned work on top of that.

## Principles

- **Use the game's own engine, not hand-copied formulas.** The live client already runs the full tick engine (`tick`, `predict`, `startFight`, `workChance`, `enhanceChance`, `hotSkill`, …) for client-side prediction, seeded from `welcome.seed` and `welcome.windows`. Score candidates by simulating them with that engine (synthetic seeds, expected-value drops), and never by peeking at the account's real future rolls.
- **One objective setting.** Every candidate is simulated once; the chosen profile reads the result:
  - Max XP: XP/hour, total or for selected skills.
  - Max profit: net gold/hour. Drops are valued at the market bid after the 2% tax; food, potions and inputs at the ask.
  - XP with a profit floor: maximize XP among options that earn at least X gold/hour.
  - Goal: shortest time to a level, an item count, or a specific craft.

## Priority stack (checked every tick)

1. Safety: low HP, death, disconnect, unclear transactions.
2. World boss: on `bossRose`, if it can be reached before it dies, interrupt immediately and keep the queue with `setAside`; resume on `bossGone`. Gathering and crafting are per-tick rolls, so stopping mid-action loses nothing. Use `bossNext` to avoid long trips just before a spawn and to bank beforehand.
3. Manual input from the player.
4. **Daily quests, always finished** (see below).
5. Timed upkeep: harvests, potion refresh, quest claims, perk purchases.
6. The planned activity.

## Daily and weekly quests

The user requires every daily to be completed; it is not gated by a time or profit threshold. The old script's 20-minute cap is replaced.

Game rules (client 1.0.1189):

| | Daily | Weekly |
|---|---|---|
| Count | 3 per day | a weekly set |
| Goals | gather 30, craft 15, kill 20 | ×8 (240, 120, 160) |
| Quest points | +1 | +3 |

- Quests come from the highest unlocked job per skill and the hardest safe monster.
- One free reroll per day applies to an unstarted daily (`rerollQuest`).
- Progress counts each successful action or kill of the exact job or monster.
- Quest points buy permanent perks (`buyPerk`):

  | Perk | Effect per rank | Max ranks | Cost |
  |---|---|---|---|
  | Deep pockets | +1 slot | 5 | 20 + 20n |
  | Quick hands | 0.5% faster | 10 | 15 + 10n |
  | Steady hands | burn and catch chance −3% | 10 | 10 + 8n |
  | Hearty meals | food heals +2.5% | 10 | 10 + 8n |
  | Quick rest | fountain heals a tick sooner | 4 | 30 + 30n |

Planner behavior:

- Finish each daily by its **cheapest path**. If supplying an input yourself takes long effort or needs an unlocked skill level, and the market sells it cheaply, buy it and craft. Example: wood for a fishing-rod daily when Woodcutting is too low.
- Let quests complete for free when they match the planned activity. Otherwise schedule them before the reset, preferring a matching hot window or nearby sites.
- Reroll only when a daily is truly impossible: no market supply and no realistic unlock.
- Spend quest points on the perk with the best marginal value. Its value is measured with the engine: the gain in score/hour × horizon ÷ cost.

## Buy versus make (all goals)

For every required input, compare the market price with the time to self-supply × the current score rate. This applies to dailies, gear, crafts and item targets. A short craft step should never trigger a long unlock chain when the input is cheap on the market.

## Gear

- **When to re-check:** a level crosses a wear requirement; a new item arrives (drop, boss loot, finished craft); prices move noticeably; or a periodic sweep at batch boundaries.
- **Candidates per slot:** owned items, craftable items (including the `upgrade` recipes for Drakestring, Emberwood, Abyssweave and Colossus), market listings at other rarities or + levels, and enhancing the current piece. Enhancement cost is the full-chain expected cost to the target +N.
- **Value:** the gain in score/hour × expected use time, until the piece is outgrown, capped at about 24–48 h.
- **Cost:** the price or crafting time, minus the resale of the old piece.
- **Execute:** buy immediately, craft as a project, and equip at the next bank visit. The 30-minute payback horizon is removed.

## Known issues found during review

- `enhanceQuote` (`src/planner/inventory.js`) omits the game's enhancing-level factor `1 + 0.002 × (level − 1)`. It underestimates the chance by about 10% at level 50 and about 20% at level 100.
- Combat income counts gold only. Drop value (normal, rare, pets, void shards, mounts) is ignored, which skews monster choice for profit.
- `checkClient` always reports compatible, so formula drift after game patches goes undetected.
- Client 1.0.1189 pays world-boss shares over 30 s. Verify that the Boss 掉落 log (`src/ui/boss-loot.js`) still records exactly one entry per kill.
- Never sent: `upgrade`, `masteryConfirm`, `buyPerk`, `rerollQuest`, crafting orders (`order*`).
