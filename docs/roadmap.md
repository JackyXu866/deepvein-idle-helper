# Roadmap

What is still open. What has shipped is in [CHANGELOG.md](../CHANGELOG.md); how the code is laid out is in [architecture.md](architecture.md).

## Check on the live account

These behave correctly in the tests but have not been seen in the game yet:

- **Vein Blessing auto-join**: on `bossAutoJoin` the round is handed to the game's own join; the helper neither pauses on its commands nor starts its own join. Then it resumes after the round.
- **Boss set-aside with no task**: when a set-aside finds the route already gone (an own walk replaced it), the round goes on instead of stopping.
- **补精通**: a quality item is crafted from held inputs (the uncommon Cobalt hoe); a forge piece is bought or made for a missing tier and quality; worn pieces are forged first.
- **Unsold stock counts as free**: with everyday selling off, watch house fuel. Spare common stock may now go into house upgrades.
- **Boss loot log**: client 1.0.1189 pays world-boss shares over 30 s. Check that 掉落 still records exactly one entry per kill (`src/ui/boss-loot.js`).

## Ideas

- **Upgrade recipes** (`{t:"upgrade", recipeId, itemId}`): Drakestring and Emberwood at Fletching 95, the Abyssweave set at Crafting 99, Colossus pieces. Needs the upgrade table extracted (the engine already contains it), planner support and validation.
- **Crafting orders** (`order*`): tips as a new source of income and XP.
- **Gear resale value** in the investment table's cost of replacing a piece.
- **Engine-based food and kill time**: calibration replaces XP and gold rates only. Simulated seconds per kill and food per hour could replace the formula's combat time and food logistics.
- **Hot-window planning**: the hot-skill schedule is deterministic (`hotSkill(tick)`), so batches could be timed into upcoming XP or rarity windows.
- **Drift alarm**: hash each fingerprinted engine function and warn when a game update changes one, so the simulation gets rechecked.
- **Collections not yet unlocked**: 补精通 skips a collection whose job is locked. It could price the levelling needed as part of its cost.
