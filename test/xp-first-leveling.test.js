import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryBudget, reviewInventory} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Leveling smithing on Cobalt greaves: uncommon bars and ore give 1.5x XP per
// craft and per coal mined, so they go into the stage, not on the market,
// even though four uncommon bars sell for far more than four common ones.
const UBAR = 1043, UORE = 1007;
function smith(goal) {
  const planner = makePlanner(), d = planner.data, bank = d.banks[0];
  planner.watchMarket = () => {};
  const melee = g => (!g.style || g.style === 'melee') && (g.slot !== 'weapon' || g.needs === 'melee' && !g.twoHanded);
  const top = Object.fromEntries([...new Set(d.gear.map(g => g.slot))].filter(slot => slot !== 'mount').map(slot =>
    [slot, d.gear.filter(g => g.slot === slot && melee(g)).sort((a, b) => (d.items[b.itemId]?.value ?? 0) - (d.items[a.itemId]?.value ?? 0))[0].itemId + 4 * d.rarityScale]));
  planner.marketUnitValue = (_p, id) => ({[UBAR]: 1470, 43: 726, 133: 1960})[id] ?? null;
  const p = player(planner, {levels: {smithing: 79, mining: 88}, x: bank.x, y: bank.y, coins: 0, hp: 100, equipment: top,
    bank: {43: 50, [UBAR]: 14, [UORE]: 400, 7: 5000, 5: 40000}, activity: 'idle', path: null, route: null});
  return {planner, d, p, goal: {skill: 'smithing', target: 85, budget: {coins: 0, items: {}}, ...goal}};
}

test('a leveling stage keeps its chain\'s quality stock for itself', () => {
  const {planner, d, p, goal} = smith({development: true, growth: true, craftPreparation: {jobId: 133, amount: 3700}, recipes: {smithing: 133}});
  const budget = inventoryBudget(d, planner, p, goal);
  assert.equal(budget.items[UBAR], 14, 'uncommon bars');
  assert.equal(budget.items[UORE], 400, 'uncommon ore');
  const row = reviewInventory(d, planner, p, goal, 'melee').items.find(r => r.itemId === UBAR);
  assert.equal(row.sell, 0, row.reason);
});

test('a quest or business goal still sells rare bars the recipe would waste', () => {
  const {planner, d, p, goal} = smith({quest: {key: 'q'}, recipes: {smithing: 133}});
  const row = reviewInventory(d, planner, p, goal, 'melee').items.find(r => r.itemId === UBAR);
  assert.ok(row.sell > 0, row.reason);
});

test('leveling crafts the uncommon greaves for their XP although the bars sell for more', () => {
  const {planner, p, goal} = smith({growth: true, recipes: {smithing: 133}, recipeId: 133, fixedRecipeId: 133, mainSkill: 'smithing'});
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(plan?.intent?.jobId, 133, JSON.stringify([plan?.label, plan?.reason]));
  assert.equal(plan.intent.rarity, 1, 'the uncommon recipe');
});
