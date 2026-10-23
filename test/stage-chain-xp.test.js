import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// Smithing 77 -> 85 on Cobalt greaves: each pair needs four Cobalt bars, and
// smelting them is smithing XP too (480 + 4 x 108), so the stage needs about
// half the greaves the greaves' own XP alone suggests. Held bars earn nothing.
function greaves(bars) {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const greave = d.jobs.find(j => j.id === 133), bar = d.jobs.find(j => j.id === 44);
  const melee = g => (!g.style || g.style === 'melee') && (g.slot !== 'weapon' || g.needs === 'melee' && !g.twoHanded);
  const top = Object.fromEntries([...new Set(d.gear.map(g => g.slot))].filter(slot => slot !== 'mount').map(slot =>
    [slot, d.gear.filter(g => g.slot === slot && melee(g)).sort((a, b) => (d.items[b.itemId]?.value ?? 0) - (d.items[a.itemId]?.value ?? 0))[0].itemId + 4 * d.rarityScale]));
  const bank = d.banks[0];
  const p = player(planner, {levels: {smithing: 77, mining: 88}, x: bank.x, y: bank.y, bank: {7: 65000, 5: 40000, 43: bars},
    equipment: top, coins: 0, hp: 100, activity: 'idle', path: null, held: false, route: null});
  const goal = {skill: 'smithing', target: 85, development: true, growth: true, recipeId: 133, recipes: {smithing: 133},
    mainSkill: 'smithing', fixedRecipeId: 133, budget: {coins: 0, items: {}}};
  planner.plan(p, goal, 'melee');
  const xp = id => planner.estimateWork(p, d.jobs.find(j => j.id === id)).xp;
  return {goal, needed: planner.thresholds[85] - p.skills.smithing, greaveXp: xp(133), barXp: xp(44), greave, bar};
}

test('a stage counts the smelting XP of the bars it still has to make', () => {
  const {goal, needed, greaveXp, barXp} = greaves(0);
  const alone = Math.ceil(needed / greaveXp), chained = Math.ceil(needed / (greaveXp + 4 * barXp));
  assert.equal(goal.craftPreparation?.jobId, 133);
  assert.ok(Math.abs(goal.craftPreparation.amount - chained) <= 1,
    `${goal.craftPreparation.amount} greaves, about ${chained} with the bars' XP (not ${alone})`);
});

test('bars already held earn no smelting XP', () => {
  const none = greaves(0), held = greaves(4000);
  assert.ok(held.goal.craftPreparation.amount > none.goal.craftPreparation.amount,
    `${held.goal.craftPreparation.amount} > ${none.goal.craftPreparation.amount}`);
});
