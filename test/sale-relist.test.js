import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Selling as a player does (live: listings were cut 10% every 30 minutes and
// the rest dumped to the merchant within two hours). A listing waits; it is
// re-listed one step under a competitor who undercuts it, but never chases a
// lone cheap ask below 90% of the market price.
function listed(feedAsk) {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: true, now: () => clock});
  const feed = ask => market.setPriceFeed({generatedAt: new Date(clock).toISOString(),
    items: {[item]: {lowestSell: ask, sellQty: 5, highestBuy: 100, buyQty: 10, avg7d: 1000, vol7d: 7000}}}, clock);
  const p = player(planner, {lastTick: 100000, coins: 1000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null, bank: {[item]: 500}});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  feed(1100);
  market.watch(p, [item], item);
  market.query(p);
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: item, bids: [{price: 100, qty: 10}], asks: [{price: 1100, qty: 5}], trades: []}]});
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(p, {intent: {t: 'marketDump', itemId: item, qty: 500, floor}, label: 'x', reason: 'y'});
  assert.equal(plan.intent.t, 'marketSell', 'listed, not sold into the 100 bid');
  assert.equal(plan.intent.price, 1080, 'one price step (20) under the 1100 ask, within 15% of the 1000 market price');
  assert.equal(plan.intent.qty, 100, 'a tenth of the 1000 a day the market takes');
  market.issued(p, plan.intent, plan);
  const order = {id: 7, itemId: item, side: 'sell', price: plan.intent.price, qtyTotal: plan.intent.qty, qtyRemaining: plan.intent.qty};
  const after = {...p, lastTick: 100010, bank: {[item]: 400}};
  market.receive({tick: 100010, m: [{t: 'snapshot', you: after, orders: [order]}]});
  market.next(after);
  clock += 3600000; // past the 30-minute review
  feed(feedAsk);
  return market.next(after);
}

test('a listing nobody undercuts waits', () => {
  assert.equal(listed(1080)?.intent?.t, undefined, 'its own price is still the lowest ask');
});

test('an undercut listing is re-listed', () => {
  assert.equal(listed(1000)?.intent?.t, 'marketCancel', 'a competitor at 1000: follow one step, still over 900');
});

test('a lone ask far below the market price is not chased', () => {
  assert.equal(listed(600)?.intent?.t, undefined, 'following 600 would be under 90% of 1000');
});
