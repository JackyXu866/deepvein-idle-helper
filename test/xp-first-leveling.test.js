import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// Leveling smithing on Cobalt greaves: the uncommon recipe gives 1.5x XP, so it
// is a candidate even though four uncommon bars sell for more than four common.
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

test('leveling crafts the uncommon greaves for their XP although the bars sell for more', () => {
  const {planner, p, goal} = smith({growth: true, recipes: {smithing: 133}, recipeId: 133, fixedRecipeId: 133, mainSkill: 'smithing'});
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(plan?.intent?.jobId, 133, JSON.stringify([plan?.label, plan?.reason]));
  assert.equal(plan.intent.rarity, 1, 'the uncommon recipe');
});
