import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {createPriceSeries, MIN_SERIES_SAMPLES} from '../src/economy/price-series.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

const HOUR = 3600000;

test('the series keeps one book price an hour (ask, else bid) and gives the week\'s median after half a day', () => {
  let clock = 1000 * HOUR;
  const series = createPriceSeries({now: () => clock});
  for (let h = 0; h < MIN_SERIES_SAMPLES - 1; h++) {
    assert.equal(series.record({5: {ask: 100 + h, bid: 50}, 6: {ask: null, bid: 40}}, clock), true);
    assert.equal(series.record({5: {ask: 999, bid: 50}}, clock + 60000), false, 'one sample an hour');
    clock += HOUR;
  }
  assert.equal(series.bookMedian(5), null, 'eleven hours prove nothing yet');
  series.record({5: {ask: 1e6, bid: 50}, 6: {ask: null, bid: 40}}, clock);
  assert.equal(series.bookMedian(5), 105, 'a freak hour does not move the median');
  assert.equal(series.bookMedian(6), 40, 'no ask: the bid');
  clock += 200 * HOUR;
  series.record({7: {ask: 1, bid: null}}, clock);
  assert.equal(series.bookMedian(5), null, 'samples past a week are dropped');
});

test('stored hours are loaded in front of the session\'s own', async () => {
  let clock = 2000 * HOUR;
  const rows = new Map();
  const store = {put: (hour, r) => rows.set(hour, r), prune: () => {}, since: async from => [...rows].filter(([h]) => h >= from).map(([hour, r]) => ({hour, rows: r}))};
  const first = createPriceSeries({now: () => clock, store});
  for (let h = 0; h < 8; h++) {first.record({5: {ask: 200, bid: null}}, clock); clock += HOUR;}
  const next = createPriceSeries({now: () => clock, store});
  for (let h = 0; h < 5; h++) {next.record({5: {ask: 100, bid: null}}, clock); clock += HOUR;}
  assert.equal(next.bookMedian(5), null);
  assert.equal(await next.load(), true);
  assert.equal(next.bookMedian(5), 200, 'eight stored hours at 200 and five new at 100');
});

// 2026-11-10: a Voidmelon seed averaged about 1,000,000 a week; its book had
// shown 1,800 to sell all week, then emptied.
test('the week\'s book median checks the average when the book is empty now, and a lone dump does not drag it', () => {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  const p = player(planner, {lastTick: 100000});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const feed = row => market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {[item]: row}}, clock);
  for (let h = 0; h < 24; h++) {feed({lowestSell: 1800, sellQty: 3, avg7d: 1000000, vol7d: 70}); clock += HOUR;}
  feed({lowestSell: null, sellQty: 0, avg7d: 1000000, vol7d: 70});
  assert.ok(market.unitValue(p, item, 1) <= 1800, `the week's book (1,800), not the average: ${market.unitValue(p, item, 1)}`);
  // A steady 1,000 all week, then one unit dumped at 100: the average stands.
  const steady = createMarket(d, planner, {now: () => clock});
  steady.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const sfeed = row => steady.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {[item]: row}}, clock);
  for (let h = 0; h < 24; h++) {sfeed({lowestSell: 1000, sellQty: 50, avg7d: 1000, vol7d: 7000}); clock += HOUR;}
  sfeed({lowestSell: 100, sellQty: 1, avg7d: 1000, vol7d: 7000});
  assert.ok(steady.unitValue(p, item, 1) > 900, `a lone dump does not set the price: ${steady.unitValue(p, item, 1)}`);
  // The Worker gets the medians with the runtime.
  const worker = createMarket(d, planner, {now: () => clock});
  worker.runtime(market.runtime());
  assert.equal(worker.bookMedian(item), 1800);
});
