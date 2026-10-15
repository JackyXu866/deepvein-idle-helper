import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseHouseFuel, housePointsOf} from '../src/planner/housing.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {COAL_ID, merchantPrice} from '../src/planner/items.js';
import {data} from './helpers.js';

const d = data(), R = d.rarityScale;
const id = name => Object.values(d.items).find(i => i.name === name).id;

test('house points follow the client: tier, x3 per quality, crafted depth bonus', () => {
  const copper = id('Copper');
  assert.deepEqual(housePointsOf(d, copper), {family: 'stone', each: 1});
  assert.equal(housePointsOf(d, copper + R).each, 3);
  assert.equal(housePointsOf(d, copper + 2 * R).each, 9);
  // Bronze bar = copper + tin (1 + 1 stone), one recipe deep: x1.5.
  assert.deepEqual(housePointsOf(d, id('Bronze bar')), {family: 'stone', each: 3});
  // Bronze blade = one bar, two recipes deep: (1 + 1) x 2.
  assert.equal(housePointsOf(d, id('Bronze blade')).each, 4);
  assert.equal(housePointsOf(d, id('Bronze blade') + d.plusScale), null, 'enhanced items cannot be converted');
});

test('fuel is the cheapest coins per point; common coal and legendary are never used', () => {
  const copper = id('Copper');
  const legendary = copper + (d.rarityMultipliers.length - 1) * R;
  const p = {bank: {[COAL_ID]: 5000, [COAL_ID + R]: 40, [copper]: 500, [copper + R]: 100, [legendary]: 50}, pack: []};
  const inventory = {items: [{itemId: copper, sellFromBank: 400}]};
  const fuel = chooseHouseFuel(d, {p, families: ['stone'], missing: 200, inventory, budget: {items: {}},
    unitValue: item => merchantPrice(d, item)});
  const used = fuel.conversions.map(c => c.itemId);
  assert.ok(!used.includes(COAL_ID), 'common coal is kept for smelting');
  assert.ok(!used.includes(legendary), 'legendary is the player\'s');
  assert.ok(fuel.donors.some(x => x.itemId === COAL_ID + R), 'uncommon coal is fuel');
  assert.equal(used[0], copper + R, 'uncommon copper: 3 points for the merchant price of 1');
  const order = fuel.donors.map(x => x.unit / x.each);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(fuel.remaining <= 0);
});

test('planned quality materials are kept out of the fuel', () => {
  const copper = id('Copper');
  const p = {bank: {[copper + R]: 100}, pack: []};
  const fuel = chooseHouseFuel(d, {p, families: ['stone'], missing: 1000, inventory: {items: []},
    budget: {items: {[copper + R]: 80}}, unitValue: item => merchantPrice(d, item)});
  assert.equal(fuel.donors[0].available, 20);
});

test('common coal is never sold', () => {
  assert.match(saleProtectionReason(d, COAL_ID), /煤炭/);
  assert.equal(d.jobs.filter(j => j.inputs.some(i => i.itemId === COAL_ID)).length > 0, true);
});
