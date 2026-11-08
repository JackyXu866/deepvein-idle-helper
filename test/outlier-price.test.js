import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {createMarketHistory} from '../src/economy/market-history.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Bogskin chaps, 2026-11-08: one sale at 120,000,000 among trades of 600-3,600
// made the 7-day average 1,072,910 over 112 sold.
const TICK = 5_000_000;
const DAY_TICKS = d => Math.round(d * 86400000 / 600);
const TRADES = [
  {price: 120000000, qty: 1, tick: TICK - DAY_TICKS(3)},
  {price: 640, qty: 10, tick: TICK - DAY_TICKS(4)},
  {price: 1500, qty: 1, tick: TICK - DAY_TICKS(5)},
  {price: 1580, qty: 100, tick: TICK - DAY_TICKS(5)},
  {price: 2550, qty: 1, tick: TICK - DAY_TICKS(11)},
];

test('the week\'s trades give a quantity-weighted median a freak trade cannot move', () => {
  let clock = 5e9;
  const history = createMarketHistory({now: () => clock});
  history.recordTrades(7, TRADES, TICK, 600);
  assert.equal(history.tradeMedian(7), 1580, 'the 11-day-old trade is outside the week');
  clock += 23 * 3600000;
  assert.equal(history.tradeMedian(7), 1580, 'a median holds for a day');
  clock += 3600000;
  assert.equal(history.tradeMedian(7), null, 'a median older than a day waits for the next book read');
});

test('a full history makes room for a book read: the id seen longest ago goes', () => {
  // 2026-11-08: 400 ids held, so rare Pelt chaps' median was never stored.
  let clock = 5e9;
  const history = createMarketHistory({now: () => clock, limit: 2});
  history.recordFeed([[1, {ask: 10, bid: 9}], [2, {ask: 20, bid: 19}]], clock - 2 * 3600000);
  history.recordFeed([[2, {ask: 20, bid: 19}]], clock);
  history.recordFeed([[3, {ask: 30, bid: 29}]], clock + 1);
  assert.equal(history.averagePrice(3, {side: 'ask'}), null, 'the feed adds no id to a full history');
  history.recordTrades(7, TRADES, TICK, 600);
  assert.equal(history.tradeMedian(7), 1580, 'the book read is kept');
  assert.equal(history.averagePrice(1, {side: 'ask'}), null, 'id 1, seen longest ago, made room');
  assert.equal(history.averagePrice(2, {side: 'ask'}), 20);
});

function setup() {
  const planner = makePlanner(), d = planner.data;
  const item = [...new Set(d.jobs.map(j => j.output.itemId))]
    .find(id => id !== d.coinId && d.items[id]?.value >= 50 && !saleProtectionReason(d, id));
  let clock = 10_000_000;
  const market = createMarket(d, planner, {autoSell: true, now: () => clock});
  const p = player(planner, {lastTick: TICK, coins: 1000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null});
  market.receive({tick: TICK, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {[item]:
    {lowestSell: null, sellQty: 0, highestBuy: null, buyQty: 0, avg7d: 1072910, vol7d: 112}}}, clock);
  return {market, d, item, p, advance: ms => { clock += ms; }};
}
const depth = (market, p, item, tick = TICK) => {
  market.watch(p, [item], item);
  market.query(p);
  market.receive({tick, m: [{t: 'marketDepth', itemId: item, bids: [], asks: [], trades: TRADES}]});
};

test('an average more than twice the week\'s median is replaced by the median when listing', () => {
  const {market, item, p} = setup();
  depth(market, p, item);
  const plan = market.sale({...p, bank: {[item]: 5}}, {intent: {t: 'marketDump', itemId: item, qty: 5, floor: 1}, label: 'x', reason: 'y'});
  assert.equal(plan.intent?.t, 'marketSell');
  assert.ok(plan.intent.price <= 1580, `listed at ${plan.intent.price}, not near 1,072,910`);
});

test('a listing above 115% of the corrected market price is taken back at its review', () => {
  const {market, item, p, advance} = setup();
  const order = {id: 801, itemId: item, side: 'sell', price: 1060000, qtyTotal: 1, qtyRemaining: 1};
  market.receive({tick: TICK, m: [{t: 'snapshot', you: p, orders: [order]}]});
  const runtime = market.runtime();
  runtime.saved.players[p.id].owned[order.id] = {...order, at: 10_000_000};
  market.runtime(runtime);
  advance(10800000);
  assert.equal(market.next(p)?.intent ?? null, null, 'no median yet: the book is asked for first');
  assert.deepEqual(market.query(p), {t: 'marketDepth', itemId: item});
  market.receive({tick: TICK, m: [{t: 'marketDepth', itemId: item, bids: [], asks: [{price: 1060000, qty: 1}], trades: TRADES}]});
  const plan = market.next(p);
  assert.equal(plan?.intent?.t, 'marketCancel');
  assert.equal(plan.intent.orderId, 801);
});
