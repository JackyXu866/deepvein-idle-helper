import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// Held stock costs what using it gives up: its sale value when the helper
// sells it, nothing when it never does (everyday selling off).
test('stock the helper never sells is free to use; sold stock costs its sale value', () => {
  const planner = makePlanner(), d = planner.data;
  const market = createMarket(d, planner, {autoSell: false, now: () => 1_000_000});
  const p = player(planner, {});
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  planner.marketUnitValue = () => 500;
  planner.stockSold = (q, id) => market.sells(q, id);
  assert.equal(market.sells(p, 15), false, 'everyday selling off');
  assert.equal(planner.stockValue(p, 15, 1), 0);
  market.setAutoSell(true);
  assert.equal(market.sells(p, 15), true);
  assert.equal(planner.stockValue(p, 15, 1), 500);
});

// Live: 出售制作产出 listed 1,000 rare meteoric bars while 补精通 valued the same
// bars at nothing (everyday selling off). One rule now: stock any sale rule
// sells costs its sale value to use.
test('crafted surplus the helper sells costs its sale value, with everyday selling off', async () => {
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const {createEconomy} = await import('../src/economy/economy.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const market = createMarket(d, planner, {autoSell: false, now: () => 1_000_000});
  let economy = createEconomy(d, planner, {sellCrafted: true});
  wirePlanner(planner, market, () => economy, () => true);
  const p = player(planner, {});
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  const bar = 44, ore = 8;
  assert.equal(planner.stockSold(p, bar + 2 * R), true, 'a rare bar is crafted surplus');
  assert.equal(planner.stockSold(p, ore), false, 'gathered ore is not');
  economy = createEconomy(d, planner, {sellCrafted: false});
  assert.equal(planner.stockSold(p, bar + 2 * R), false, '出售制作产出 off');
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
