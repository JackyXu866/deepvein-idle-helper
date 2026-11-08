import test from 'node:test';
import assert from 'node:assert/strict';
import {craftRecipe} from '../src/planner/quality.js';
import {makePlanner, player} from './helpers.js';

// One route for every slot: get a piece (held, made, bought; a mount also bred
// or from the merchant), then enhance it to its best +k. A melee fighter in a
// common Cobalt blade.
// `asks(blade, R)`: market asks by item id.
function fighter({coins = 50_000_000, asks = () => ({}), bank = {}} = {}) {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  planner.coinRate = () => 500;
  const blade = d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name.startsWith('Cobalt blade')).itemId;
  const book = asks(blade, d.rarityScale);
  planner.marketAsk = (_p, id) => book[id] ?? null;
  const p = player(planner, {levels: {melee: 62, defence: 60, hitpoints: 62, mining: 55, smithing: 70, thieving: 50}, coins, hp: 600,
    equipment: {weapon: blade}, bank, activity: 'idle', path: null, held: false});
  return {planner, d, p, blade, weapon: () => planner.investmentOptions(p, 'melee', null).filter(r => r.slot === 'weapon')};
}

test('a piece bought on the market and then enhanced is one route, on any slot', () => {
  const {d, blade, weapon} = fighter({asks: (b, R) => ({[b + 2 * R]: 30_000})});
  const rare = blade + 2 * d.rarityScale;
  const row = weapon().find(r => r.start === rare);
  assert.ok(row, JSON.stringify(weapon().map(r => r.label)));
  assert.equal(row.source, '市场');
  assert.equal(row.acquireGold, 30_000);
  assert.ok(row.toPlus > 0 && row.kind === 'acquireEnhance', 'bought, then enhanced');
  assert.ok(row.gold > row.acquireGold, 'the whole route is priced: the enhancing too');
});

test('legendary gear is bought to wear on every slot, not only a mount', () => {
  const {d, blade, weapon} = fighter({asks: (b, R) => ({[b + 4 * R]: 50_000})});
  const legendary = blade + 4 * d.rarityScale;
  const pick = weapon().find(r => r.cheapest);
  assert.equal(pick?.start, legendary, JSON.stringify(weapon().map(r => [r.label, Math.round(r.net)])));
  assert.equal(pick.source, '市场');
});

test('a legendary piece made from legendary materials is advice for the player, never the pick', () => {
  const {planner, d, p, blade, weapon} = fighter();
  const recipe = craftRecipe(d, d.jobs.find(j => j.output.itemId === blade), 4);
  const legendaryInputs = recipe.inputs.filter(i => Math.floor(i.itemId / d.rarityScale) % 10 === 4);
  assert.ok(legendaryInputs.length, JSON.stringify(recipe.inputs));
  planner.marketAsk = (_p, id) => legendaryInputs.some(i => i.itemId === id) ? 100 : null;
  const rows = weapon(), manual = rows.find(r => r.source === '手动制作');
  assert.ok(manual, JSON.stringify(rows.map(r => r.label)));
  assert.equal(manual.cheapest, false, 'the helper never makes it');
  assert.equal(manual.advice, manual.worth && !rows.some(r => r !== manual && r.worth && r.net > manual.net));
  assert.deepEqual(manual.manual.buy.map(b => b.itemId).sort(), legendaryInputs.map(i => i.itemId).sort());
  // Planning never starts it as a gear project.
  const goal = {skill: 'melee', target: 63, development: true, growth: true, budget: {coins: 0, items: {}}};
  planner.plan(p, goal, 'melee');
  assert.notEqual(goal.upgrade?.id, blade + 4 * d.rarityScale);
});

test('a piece already worn or held is never made or bought again at its +N or lower', () => {
  const {planner, d, blade} = fighter();
  const legendary = blade + 4 * d.rarityScale, worn = legendary + 5 * d.plusScale;
  const recipe = craftRecipe(d, d.jobs.find(j => j.output.itemId === blade), 4);
  const asks = {[legendary]: 50_000, [legendary + 3 * d.plusScale]: 60_000, [legendary + 8 * d.plusScale]: 900_000};
  for (const i of recipe.inputs) asks[i.itemId] = 100;
  planner.marketAsk = (_p, id) => asks[id] ?? null;
  for (const equipment of [{weapon: worn}, {weapon: blade}]) {
    const p = player(planner, {levels: {melee: 99, defence: 60, hitpoints: 62, mining: 55, smithing: 99, thieving: 50}, coins: 50_000_000, hp: 600,
      equipment, bank: equipment.weapon === blade ? {[worn]: 1} : {}, activity: 'idle', path: null, held: false});
    const rows = planner.investmentOptions(p, 'melee', null).filter(r => r.slot === 'weapon' && r.start % d.plusScale === legendary);
    assert.ok(!rows.some(r => r.source === '手动制作'), JSON.stringify(rows.map(r => r.label)));
    assert.ok(!rows.some(r => r.source === '市场' && r.start !== legendary + 8 * d.plusScale), 'no lower copy is bought');
  }
});

test('a route starts only when its whole cost, enhancing included, is affordable', () => {
  const {planner, d, p, blade} = fighter({coins: 0, asks: (b, R) => ({[b + 2 * R]: 30_000})});
  const pick = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'weapon' && r.cheapest);
  assert.ok(pick && pick.gold > 0);
  const rich = {...p, coins: pick.acquireGold ?? pick.gold};
  if (pick.acquireGold != null && pick.acquireGold < pick.gold) {
    const plan = planner.plan(rich, {skill: 'thieving', target: 51, budget: {coins: 0, items: {}}}, 'melee');
    assert.notEqual(plan?.intent?.t, 'marketBuy', 'enough for the piece, not for its enhancing: funding first');
  }
  void d;
});
