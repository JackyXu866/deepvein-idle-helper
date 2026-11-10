import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {createEconomy} from '../src/economy/economy.js';
import {wirePlanner} from '../src/economy/wiring.js';
import {makePlanner, player} from './helpers.js';

// 2026-11-09: a fletching stage held back the bank's yew logs, so a sale took
// two or three batches. The gold table re-estimated 50 actions a batch but
// counted a whole batch's logs (about 450 actions) for each: yew showed 3.2M
// an hour instead of about 0.7M, and gold was earned there instead of mining.
function yewRate(reserved) {
  const planner = makePlanner(), d = planner.data, clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: true, now: () => clock});
  const economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => false);
  const p = player(planner, {levels: {woodcutting: 82}, lastTick: 100000, bank: {14: 1431}});
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {
    14: {lowestSell: 395, sellQty: 81120, highestBuy: 182, buyQty: 88000, avg7d: 273, vol7d: 1661755},
    1014: {lowestSell: 1260, sellQty: 66212, highestBuy: 1140, buyQty: 22982, avg7d: 1058, vol7d: 403807},
    2014: {lowestSell: 8000, sellQty: 1533, highestBuy: 7300, buyQty: 4637, avg7d: 6293, vol7d: 47414}}}, clock);
  planner.parkedGoals = () => reserved ? [{budget: {items: {14: reserved}}}] : [];
  const yew = planner.candidates(p, 'melee', {}).filter(c => c.recipeId === 34);
  return planner.incomeChoices(p, yew, 'melee')[0]?.rate.coins;
}

test('a sale that takes several batches does not change the rate: one batch\'s value over one batch\'s time', () => {
  const free = yewRate(0);
  assert.ok(free > 0);
  for (const reserved of [2200, 2600]) {
    const held = yewRate(reserved);
    assert.ok(Math.abs(held / free - 1) < .02, `${reserved} held back: ${Math.round(held * 3600)} vs ${Math.round(free * 3600)} an hour`);
  }
});
