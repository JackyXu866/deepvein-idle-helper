import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

function setup(bank, levels = {}) {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  const blade = n => d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name === `${n} blade`).itemId;
  const bar = d.jobs.find(j => j.output.itemId === blade('Cobalt')).inputs[0].itemId;
  const barJob = d.jobs.find(j => j.output.itemId === bar);
  const ore = barJob.inputs.find(i => d.items[i.itemId].name === 'Cobalt').itemId;
  const at = d.banks[0];
  const p = player(planner, {levels: {melee: 70, defence: 60, hitpoints: 60, smithing: 62, mining: 60, ...levels}, x: at.x, y: at.y,
    equipment: {weapon: blade('Steel') + 3 * R}, bank: bank({bar, ore, R}), coins: 0, hp: 600,
    activity: 'idle', path: null, held: false, route: null});
  const goal = {skill: 'smithing', target: 65, development: true, growth: true, recipeId: barJob.id, recipes: {smithing: barJob.id},
    budget: {coins: 0, items: {}}};
  return {planner, d, p, goal, R, blade, bar, ore, barJob};
}

test('the planned quality piece is crafted first, from its own materials', () => {
  const {planner, p, goal, R, blade} = setup(({bar, ore, R}) => ({[bar + 2 * R]: 1, [ore]: 50, 5: 500}));
  assert.deepEqual(planner.plannedQualityGear(p, 'melee'), [blade('Cobalt') + 2 * R], 'rare cobalt blade beats epic steel');
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(plan.intent?.jobId, planner.data.jobs.find(j => j.output.itemId === blade('Cobalt')).id, plan.reason);
  assert.equal(plan.intent?.rarity, 2);
  assert.equal(plan.intent?.limit, 1, 'one piece; its own bar is not held against it');
  assert.match(plan.reason, /先打造计划装备/);
});

test('quality materials for planned gear are held down the chain and not counted for the stage', () => {
  const {planner, p, goal, R, bar, ore, barJob} = setup(({ore, R}) => ({[ore + 2 * R]: 40, [ore]: 50, 5: 500}), {smithing: 50});
  const reserve = planner.plannedGearReserve(p, 'melee');
  assert.equal(reserve[bar + 2 * R], 1, 'the rare bar the blade needs');
  assert.ok(reserve[ore + 2 * R] > 0, 'and the rare ore to make it');
  // Smithing 50 cannot make the blade yet: the stage trains, leaving those materials alone.
  const plan = planner.plan(p, goal, 'melee');
  assert.doesNotMatch(String(plan.reason), /先打造计划装备/);
  const held = reserve[ore + 2 * R], needPerBar = barJob.inputs.find(i => i.itemId === ore).qty;
  const usable = Math.floor((40 - held) / needPerBar);
  assert.ok(planner.crafting.available(p, barJob, 2, reserve, 5000) <= usable, 'reserved rare ore is not training stock');
});
