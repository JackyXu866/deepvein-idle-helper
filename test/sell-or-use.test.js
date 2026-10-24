import test from 'node:test';
import assert from 'node:assert/strict';
import {planUseValue, reviewInventory} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Leveling smithing on Cobalt greaves with uncommon bars in the bank. One rule
// for sell or use: a bar goes into the stage when the stage time it saves (its
// share of the greave's 1.5x XP at the chain's real XP rate, at the gold rate)
// beats its sale price; otherwise it is sold.
const UBAR = 1043;
function smith(barPrice) {
  const planner = makePlanner(), d = planner.data, bank = d.banks[0];
  planner.watchMarket = () => {};
  planner.coinRate = () => 50;
  const melee = g => (!g.style || g.style === 'melee') && (g.slot !== 'weapon' || g.needs === 'melee' && !g.twoHanded);
  const top = Object.fromEntries([...new Set(d.gear.map(g => g.slot))].filter(slot => slot !== 'mount').map(slot =>
    [slot, d.gear.filter(g => g.slot === slot && melee(g)).sort((a, b) => (d.items[b.itemId]?.value ?? 0) - (d.items[a.itemId]?.value ?? 0))[0].itemId + 4 * d.rarityScale]));
  planner.marketUnitValue = (_p, id) => ({[UBAR]: barPrice, 43: 726, 133: 1960})[id] ?? null;
  const p = player(planner, {levels: {smithing: 79, mining: 88}, x: bank.x, y: bank.y, coins: 0, hp: 100, equipment: top,
    bank: {43: 50, [UBAR]: 14, 7: 5000, 5: 40000}, activity: 'idle', path: null, route: null});
  const goal = {skill: 'smithing', target: 85, growth: true, recipes: {smithing: 133}, recipeId: 133, fixedRecipeId: 133,
    mainSkill: 'smithing', budget: {coins: 0, items: {}}};
  return {planner, d, p, goal, use: planUseValue(d, planner, p, goal, UBAR)};
}

test('an uncommon bar is worth its share of stage time to a leveling plan', () => {
  const {use} = smith(1470);
  assert.ok(use > 0 && Number.isFinite(use), `${use}`);
});

test('bars worth more to the stage than their price go into it and are not sold', () => {
  const {planner, d, p, goal, use} = smith(1);
  assert.ok(use > 1);
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(plan?.intent?.jobId, 133, JSON.stringify([plan?.label, plan?.reason]));
  assert.equal(plan.intent.rarity, 1, 'the uncommon recipe');
  assert.equal(reviewInventory(d, planner, p, goal, 'melee').items.find(r => r.itemId === UBAR).sell, 0);
});

test('bars that sell for more than they save the stage are sold, not crafted', () => {
  const {planner, d, p, goal, use} = smith(1e6);
  assert.ok(use < 1e6);
  const plan = planner.plan(p, goal, 'melee');
  assert.notEqual(plan?.intent?.rarity, 1, JSON.stringify([plan?.label, plan?.reason]));
  assert.equal(reviewInventory(d, planner, p, goal, 'melee').items.find(r => r.itemId === UBAR).sell, 14);
});

test('a leveling stage keeps every common material it needs, and only that', () => {
  const {planner, d, p, goal} = smith(1e6);
  const supply = planner.stageSupply(p, goal), crafts = planner.stageCraftCount(p, 'smithing', 85, d.jobs.find(j => j.id === 133));
  assert.equal(supply[43], crafts * 4, 'four bars a pair of greaves');
  assert.equal(supply[7], crafts * 4, 'and the cobalt for them');
  const rich = {...p, bank: {...p.bank, 7: crafts * 4 + 1000}};
  planner.marketUnitValue = (_p, id) => ({[UBAR]: 1e6, 7: 150})[id] ?? null;
  const ore = reviewInventory(d, planner, rich, goal, 'melee').items.find(r => r.itemId === 7);
  assert.equal(ore.keep, crafts * 4, ore.reason);
  assert.equal(ore.sell, 1000, 'only what the stage does not need is sold');
});

test('what the current batch makes or uses is judged after the batch', () => {
  const {planner, d, p, goal} = smith(1e6);
  const working = {...p, route: {jobId: 44, siteId: 1, limit: 100, onFull: 'bank'}};
  const row = reviewInventory(d, planner, working, goal, 'melee').items.find(r => r.itemId === UBAR);
  assert.equal(row.sell, 0, row.reason);
});
