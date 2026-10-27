import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// One make-or-buy verdict (input-cost.js decide), acted on by every buy step:
// the price as time at the gold rate plus a bank trip, against the making time
// less the XP it earns in trained skills. No bias, no horizon.
function bars() {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 10;
  const job = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar');
  const inputs = job.inputs.map(i => i.itemId);
  planner.marketBuyPrice = (_p, id) => inputs.includes(id) ? 10 : Infinity; // 1 second of gold per ore
  const p = player(planner, {levels: {smithing: 20}});
  return {planner, d, job, p};
}

test('the verdict: buy when the price as time beats making it (XP credited); quests credit no XP', () => {
  const {planner, job, p} = bars();
  const bar = job.output.itemId;
  const making = planner.inputCost.decide(p, bar, 10, {style: 'melee', price: Infinity});
  assert.equal(making.buy, false);
  assert.ok(Number.isFinite(making.seconds), 'made from bought ore');
  assert.equal(planner.inputCost.decide(p, bar, 10, {style: 'melee', price: 1}).buy, true, 'a tenth of a second each: buy');
  assert.equal(planner.inputCost.decide(p, bar, 10, {style: 'melee', price: 10_000}).buy, false, 'far dearer: make');
  const quest = planner.inputCost.decide(p, bar, 10, {style: 'melee', price: Infinity, credit: false});
  assert.ok(quest.seconds > making.seconds, 'a quest credits no XP: making costs its full time');
});

test('a market purchase acts on the verdict at the live ask, whatever the horizon', () => {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 10;
  const clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar').output.itemId;
  const p = player(planner, {lastTick: 100000, coins: 1_000_000, levels: {smithing: 20}, x: d.banks[0].x, y: d.banks[0].y, path: null});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.watch(p, [bar], bar);
  assert.deepEqual(market.query(p), {t: 'marketDepth', itemId: bar});
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: bar, bids: [], asks: [{price: 50, qty: 500}], trades: []}]});
  const goal = {horizon: 60, budget: {coins: 0, items: {}}}; // a short horizon no longer refuses
  const seen = [];
  planner.inputCost.decide = (_p, id, qty, options) => {seen.push(options.price); return {buy: false};};
  assert.equal(market.purchase(p, bar, 10, goal, 'melee'), null, 'make it instead');
  assert.deepEqual(seen, [50], 'judged at the live ask');
  planner.inputCost.decide = () => ({buy: true});
  assert.equal(market.purchase(p, bar, 10, goal, 'melee')?.intent?.t, 'marketBuy');
});
