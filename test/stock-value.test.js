import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// Held stock costs what using it gives up: what it would sell for, whatever the
// helper's own sale settings (live: logs selling for 100+ on the market were
// burnt as free house fuel, and 出售制作产出 listed rare bars that 补精通 valued at
// nothing). Only what cannot be sold at all is free to use.
test('held stock costs what it would sell for, whatever the sale settings', async () => {
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const {createEconomy} = await import('../src/economy/economy.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const market = createMarket(d, planner, {autoSell: false, now: () => 1_000_000});
  wirePlanner(planner, market, () => createEconomy(d, planner, {sellCrafted: false}), () => true);
  const p = player(planner, {});
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  const bar = 44, ore = 8, logs = 15;
  for (const id of [logs, ore, bar + 2 * R]) assert.equal(planner.stockSold(p, id), true, `${id}: everyday selling off, still worth its price`);
  assert.equal(planner.stockSold(p, ore + 4 * R), false, 'legendary is never sold: free to the plans that may use it');
  assert.equal(planner.stockValue(p, ore + 4 * R, 1), 0);
});

// The value is what the sale rule itself gets: the day's traded price after
// tax (the price it lists at), not only buy orders that could take the stock
// already held, which left a bank of logs at the merchant's price.
test('an item is worth the day\'s traded price, however much is held', () => {
  const planner = makePlanner(), d = planner.data, clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: false, now: () => clock});
  const p = player(planner, {bank: {10: 5000}}); // plain logs: the merchant pays 1
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {10: {lowestSell: 120, sellQty: 50, highestBuy: 20, buyQty: 10, avg7d: 110, vol7d: 7000}}});
  const value = market.unitValue(p, 10, 1);
  assert.ok(value > 90 && value <= 110, `logs at about the day's 110 after tax: ${value}`);
});
test('a leveling stage crafts from quality stock that would never be sold, however dear it sells', () => {
  for (const sold of [true, false]) {
    const planner = makePlanner(), d = planner.data;
    const p = player(planner, {levels: {fletching: 80, woodcutting: 81, melee: 70, defence: 61, hitpoints: 61, mining: 91, smithing: 85}, coins: 1_000_000,
      route: null, path: null, activity: 'idle', held: false,
      equipment: {pickaxe: 54084, rod: 53088, axe: 53093, gloves: 53326, pan: 43363, hammer: 53369, knife: 53373, needle: 53378, mortar: 53383,
        hoe: 3389, weapon: 43113, shield: 24118, helmet: 33123, body: 3128, legs: 43133, ring: 53182, amulet: 3186}});
    p.bank = {...p.bank, 15: 4, 1015: 400};
    planner.coinRate = () => 170;
    planner.marketUnitValue = (_p, id) => id === 1015 ? 50_000 : id === 15 ? 260 : null; // far above what it saves the stage
    planner.stockSold = () => sold;
    const plan = planner.plan(p, {skill: 'fletching', target: 81, development: true, craftPreparation: {jobId: 205, amount: 30}}, 'melee');
    if (sold) assert.notEqual(plan?.intent?.rarity, 1, 'sold stock is kept for its price: ' + JSON.stringify(plan?.intent));
    else assert.equal(plan?.intent?.rarity, 1, 'unsold stock is crafted: ' + JSON.stringify(plan?.intent) + ' ' + plan?.reason);
  }
});
