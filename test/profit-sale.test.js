import test from 'node:test';
import assert from 'node:assert/strict';
import {createEconomy} from '../src/economy/economy.js';
import {makePlanner, player} from './helpers.js';

function setup() {
  const planner = makePlanner(), d = planner.data;
  const copper = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1 && !j.inputs.length);
  const ore = copper.output.itemId;
  const sold = [];
  planner.marketSale = (p, vendor) => { sold.push(vendor); return vendor; };
  const economy = createEconomy(d, planner, {autoSell: false, capacitySales: true});
  const bank = d.banks[0];
  const p = player(planner, {levels: {mining: 10}, x: bank.x, y: bank.y, bank: {[ore]: 400}, coins: 100, hp: 100,
    activity: 'idle', path: null, held: false});
  return {economy, p, copper, ore, sold};
}

test('everyday selling off: the profit task output is still sold', () => {
  const {economy, p, copper, ore, sold} = setup();
  const goal = {skill: 'mining', recipeId: copper.id, target: 11, budget: {items: {}, coins: 0}, saleItems: [ore]};
  const plan = economy.maintenance(p, goal, 'melee', 'business');
  assert.ok(sold.length > 0, 'a sale was considered');
  assert.equal(sold[0].intent.itemId, ore);
  assert.equal(sold[0].profitSale, true);
  assert.ok(sold[0].intent.qty <= 400 - 50, 'working stock kept');
  assert.equal(plan?.profitSale, true);
});

test('everyday selling off and no profit goal: nothing is sold', () => {
  const {economy, p, copper, sold} = setup();
  const goal = {skill: 'mining', recipeId: copper.id, target: 11, budget: {items: {}, coins: 0}};
  economy.maintenance(p, goal, 'melee', 'experience');
  assert.equal(sold.length, 0);
});
