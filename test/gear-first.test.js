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

test('held materials are shared between planned pieces, never counted twice', () => {
  const {planner, p, R, bar, ore} = setup(({bar, ore, R}) => ({[bar + 2 * R]: 1, [ore + 2 * R]: 40, [ore]: 50, 5: 500}), {smithing: 50});
  const reserve = planner.plannedGearReserve(p, 'melee');
  assert.equal(reserve[bar + 2 * R], 1, 'the one rare bar goes to one piece');
  assert.ok(reserve[ore + 2 * R] > 0, 'the other pieces hold ore for their own bars');
});

test('the plan aims at the highest quality the owned materials can make', () => {
  const ores = (rare, epic) => ({ore, R}) => ({[ore + 2 * R]: rare, [ore + 3 * R]: epic, [ore]: 50, 5: 500});
  const epic = setup(ores(40, 40), {smithing: 50});
  const cobalt = epic.blade('Cobalt');
  assert.ok(epic.planner.plannedQualityGear(epic.p, 'melee').includes(cobalt + 3 * epic.R), 'epic ore: plan the epic blade');
  const rare = setup(ores(40, 0), {smithing: 50});
  assert.ok(rare.planner.plannedQualityGear(rare.p, 'melee').includes(cobalt + 2 * rare.R), 'rare ore only: the rare blade');
  const none = setup(({ore}) => ({[ore]: 50, 5: 500}), {smithing: 50});
  assert.ok(none.planner.plannedQualityGear(none.p, 'melee').includes(cobalt + 2 * none.R),
    'no quality ore: the lowest quality that beats epic steel, as a target to look for');
  assert.equal(none.planner.equipmentStatus(none.p, 'melee').find(s => s.slot === 'weapon').upgrade.id, cobalt + 2 * none.R);
});

test('quality materials for planned gear are held down the chain and not counted for the stage', () => {
  const {planner, p, goal, R, bar, ore, barJob} = setup(({ore, R}) => ({[ore + 2 * R]: 40, [ore]: 50, 5: 500}), {smithing: 50});
  const reserve = planner.plannedGearReserve(p, 'melee');
  assert.ok(planner.plannedQualityGear(p, 'melee').includes(planner.data.gear.find(g => planner.data.items[g.itemId].name === 'Cobalt blade').itemId + 2 * R),
    'the weapon is planned first');
  assert.equal(reserve[bar + 2 * R] ?? 0, 0, 'no rare bars held, so none to keep');
  assert.ok(reserve[ore + 2 * R] > 0 && reserve[ore + 2 * R] <= 40, 'the rare ore to make them is held, never more than owned');
  // Smithing 50 cannot make the blade yet: the stage trains, leaving those materials alone.
  const plan = planner.plan(p, goal, 'melee');
  assert.doesNotMatch(String(plan.reason), /先打造计划装备/);
  const held = reserve[ore + 2 * R], needPerBar = barJob.inputs.find(i => i.itemId === ore).qty;
  const usable = Math.floor((40 - held) / needPerBar);
  assert.ok(planner.crafting.available(p, barJob, 2, reserve, 5000) <= usable, 'reserved rare ore is not training stock');
});
