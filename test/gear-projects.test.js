import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// Gear projects (pieces to make) follow the investment table: the piece made
// is a slot's pick when its source is 自制, priced by the shared input cost
// (the work and its inputs, less the XP it earns in trained skills) plus the
// route's walking, against the time it saves while worn.
function miner(level, worn) {
  const planner = makePlanner(), d = planner.data, bank = d.banks[0];
  planner.coinRate = () => 5;
  const pickaxe = name => d.gear.find(g => g.slot === 'pickaxe' && d.items[g.itemId].name === name).itemId;
  const p = player(planner, {levels: {mining: level, smithing: level}, x: bank.x, y: bank.y, path: null, activity: 'idle',
    equipment: {pickaxe: pickaxe(worn)}, bank: {}});
  const goal = {skill: 'mining', target: level + 1, development: true, growth: true, budget: {coins: 0, items: {}}};
  return {planner, d, p, goal, pickaxe};
}

test('a piece to make is priced with its crafting XP credited, plus the walking', () => {
  const {planner, d, p, goal, pickaxe} = miner(45, 'Iron pickaxe');
  const row = planner.investmentOptions(p, 'melee', goal).find(r => r.id === pickaxe('Steel pickaxe'));
  assert.equal(row?.source, '自制');
  const recipe = d.jobs.find(j => j.output.itemId === pickaxe('Steel pickaxe'));
  const made = planner.inputCost.make(p, recipe, 1), route = planner.routeEstimate(p, recipe, 1, {});
  assert.ok(made.effective < made.seconds, 'the smithing and mining XP is credited');
  assert.ok(Math.abs(row.paid - (made.effective + route.seconds - made.seconds)) < 1e-6, `${row.paid}`);
});

test('the project started is the table\'s 自制 pick with the largest net saving, on any slot', () => {
  const {planner, p, goal} = miner(60, 'Iron pickaxe');
  const picks = planner.investmentOptions(p, 'melee', goal).filter(r => r.cheapest && r.source === '自制');
  assert.ok(picks.length >= 2, 'a hammer (none worn) and a pickaxe');
  planner.plan(p, goal, 'melee');
  assert.equal(goal.upgrade?.id, picks[0].id, picks.map(r => r.label).join(', '));
});

test('a project whose row no longer pays back is dropped', () => {
  const {planner, p, goal, pickaxe} = miner(30, 'Bronze pickaxe');
  const steel = pickaxe('Steel pickaxe');
  assert.ok(!planner.investmentOptions(p, 'melee', goal).find(r => r.id === steel)?.worth, 'not a row that pays back');
  goal.upgrade = {id: steel, slot: 'pickaxe', skill: 'mining', priority: true};
  planner.plan(p, goal, 'melee');
  assert.notEqual(goal.upgrade?.id, steel);
});
