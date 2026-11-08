import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Nine of the helper's own sell listings fill every sell slot (ten slots, one
// kept for buying). Item ids are tradable outputs; the feed gives each a price
// and a week's volume.
function setup({listings, feed, owned = () => true, age = 0}) {
  const planner = makePlanner(), d = planner.data;
  const items = [...new Set(d.jobs.map(j => j.output.itemId))]
    .filter(id => id !== d.coinId && d.items[id]?.value >= 50 && !saleProtectionReason(d, id));
  let clock = 10_000_000;
  const market = createMarket(d, planner, {autoSell: true, now: () => clock});
  const p = player(planner, {lastTick: 100000, coins: 1000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null});
  const orders = listings(items).map((o, i) => ({id: 700 + i, side: 'sell', qtyTotal: o.qtyRemaining, ...o}));
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders}]});
  const runtime = market.runtime();
  for (const o of orders) if (owned(o)) runtime.saved.players[p.id].owned[o.id] = {...o, at: clock - age};
  market.runtime(runtime);
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: Object.fromEntries(feed(items).map(([id, avg, vol]) =>
    [id, {lowestSell: avg, sellQty: 100, highestBuy: 0, buyQty: 0, avg7d: avg, vol7d: vol}]))}, clock);
  const sale = (id, qty) => market.sale({...p, bank: {[id]: qty}}, {intent: {t: 'marketDump', itemId: id, qty, floor: 1}, label: 'x', reason: 'y'});
  return {market, items, p, sale, orders};
}

test('a full order book gives the weakest own listing\'s slot to a sale worth twice as much a day', () => {
  // Eight listings of 1 at 100,000 (one sale a day) and a slow one at 50.
  const {sale, items, orders} = setup({
    listings: items => items.slice(0, 9).map((itemId, i) => ({itemId, price: i === 3 ? 50 : 100000, qtyRemaining: 1})),
    feed: items => [...items.slice(0, 9).map(id => [id, 100000, 7]), [items[9], 300, 700000]],
  });
  // The waiting sale: a tenth of 100,000 a day at 300 = 3,000,000 a day.
  const plan = sale(items[9], 50000);
  assert.equal(plan.intent?.t, 'marketCancel');
  assert.equal(plan.intent.orderId, orders[3].id, 'the slow listing gives way');
});

test('a sale not worth twice the weakest listing waits, and the player\'s own orders are never taken back', () => {
  const close = setup({
    listings: items => items.slice(0, 9).map(itemId => ({itemId, price: 100000, qtyRemaining: 1})),
    feed: items => [...items.slice(0, 9).map(id => [id, 100000, 7]), [items[9], 150, 7000]],
  });
  assert.equal(close.sale(close.items[9], 5000).intent ?? null, null, '150 x 100 a day is under twice 100,000');
  const players = setup({
    listings: items => items.slice(0, 9).map(itemId => ({itemId, price: 50, qtyRemaining: 1})),
    feed: items => [...items.slice(0, 9).map(id => [id, 50, 7]), [items[9], 300, 700000]],
    owned: () => false,
  });
  assert.equal(players.sale(players.items[9], 50000).intent ?? null, null, 'the player\'s orders stay');
});

test('a listing sold down is merged with the new surplus into one order after the review', () => {
  const listings = items => [{itemId: items[0], price: 300, qtyRemaining: 100}];
  const feed = items => [[items[0], 300, 70000]];
  const old = setup({listings, feed, age: 1800000});
  const plan = old.sale(old.items[0], 5000);
  assert.equal(plan.intent?.t, 'marketCancel', 'taken back to list 100 + 5,000 as one order');
  assert.equal(plan.intent.orderId, old.orders[0].id);
  const fresh = setup({listings, feed, age: 60000});
  assert.equal(fresh.sale(fresh.items[0], 5000).intent ?? null, null, 'a fresh listing waits its review');
  const full = setup({listings: items => [{itemId: items[0], price: 300, qtyRemaining: 900}], feed, age: 1800000});
  assert.equal(full.sale(full.items[0], 5000).intent ?? null, null, 'still near a full listing (1,000): kept');
});

test('two own orders of one item are merged: the smaller is taken back', () => {
  const {market, p, orders} = setup({
    listings: items => [{itemId: items[0], price: 300, qtyRemaining: 40}, {itemId: items[0], price: 310, qtyRemaining: 10}],
    feed: items => [[items[0], 300, 70000]],
  });
  const plan = market.next({...p, bank: {}});
  assert.equal(plan?.intent?.t, 'marketCancel');
  assert.equal(plan.intent.orderId, orders[1].id);
});
