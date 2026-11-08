import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Output is sold in larger batches: one sale fills every buy order at the
// best price, and an item is sold at most once every 3 hours (a full bank
// still sells at once).
const pickItem = d => d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 50 && !saleProtectionReason(d, id));

function setup() {
  const planner = makePlanner(), d = planner.data, item = pickItem(d);
  const merchant = Math.max(1, Math.floor(d.items[item].value * .4));
  let clock = 1_000_000;
  const market = createMarket(d, planner, {autoSell: true, capacitySales: true, now: () => clock});
  const p = player(planner, {lastTick: 100000, coins: 1000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const book = () => {
    market.watch(p, [item], item);
    market.query(p);
    market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: item, bids: [
      {price: merchant * 2, qty: 44}, {price: merchant * 2, qty: 391}, {price: merchant * 2 - 1, qty: 500}], asks: [], trades: []}]});
  };
  book();
  const sell = (qty, extra = {}) => market.sale({...p, bank: {[item]: qty}},
    {intent: {t: 'marketDump', itemId: item, qty, floor: merchant}, label: 'x', reason: 'y', ...extra});
  return {market, item, merchant, p, sell, book, advance: ms => { clock += ms; }};
}

test('one sale fills every buy order at the best price', () => {
  const {sell, merchant} = setup();
  const plan = sell(2000);
  assert.equal(plan.intent.t, 'marketSell');
  assert.equal(plan.intent.price, merchant * 2);
  assert.equal(plan.intent.qty, 44 + 391, 'both orders at that price, not just the first');
});

test('an item is sold at most once every 3 hours; a full bank still sells', () => {
  const {market, sell, p, item, book, advance} = setup();
  const first = sell(2000);
  market.issued({...p, bank: {[item]: 2000}}, first.intent, first);
  // The sale filled and was settled.
  const runtime = market.runtime();
  runtime.saved.players[p.id].attempt = null;
  market.runtime(runtime);
  advance(60000);
  book();
  const soon = sell(1565);
  assert.equal(soon.marketDeferred, true, 'waits to gather a batch');
  assert.match(soon.reason, /3 小时/);
  assert.equal(sell(1565, {capacitySale: true}).marketDeferred, undefined, 'a full bank sells at once');
  advance(3 * 3600000);
  book();
  assert.equal(sell(1565).intent.t, 'marketSell', 'after 3 hours the batch sells');
});
