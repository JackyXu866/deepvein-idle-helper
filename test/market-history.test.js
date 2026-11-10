import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKET_HISTORY_KEY, createMarketHistory} from '../src/economy/market-history.js';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {marketGuard, mergeMarketRuntime} from '../src/worker/planning.js';
import {makePlanner, player} from './helpers.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const net = (price, qty) => price * qty - Math.floor(price * qty * 200 / 10000);
function store() {
  let clock = 100 * DAY;
  const history = createMarketHistory({now: () => clock});
  return {history, advance: ms => { clock += ms; }, now: () => clock};
}

test('old trade buckets fold into days and leave after a week; the id limit holds', () => {
  const {history, advance} = store();
  const tickMs = 600;
  history.recordTrades(5, [{price: 100, qty: 10, tick: 10000}], 10000, tickMs);
  advance(2 * DAY);
  history.load(history.text());
  assert.equal(history.state().items[5].days.length, 1, 'the first trade now sits in a daily bucket');
  advance(8 * DAY);
  history.load(history.text());
  assert.equal(history.state().items[5], undefined, 'nothing within the week: forgotten');
  const small = createMarketHistory({now: () => 100 * DAY, limit: 2});
  for (const id of [1, 2, 3]) small.recordTrades(id, [{price: 5, qty: 1, tick: 10000}], 10000, tickMs);
  assert.equal(Object.keys(small.state().items).length, 2, 'never more than the limit');
});
test('trades count once, give a weighted price, and a daily volume after a day of watching', () => {
  const {history, advance, now} = store();
  const tickMs = 600, perHour = HOUR / tickMs;
  // At tick 10000: trades 30 and 10 hours old.
  history.recordTrades(5, [{price: 100, qty: 10, tick: 10000 - 30 * perHour}, {price: 200, qty: 10, tick: 10000 - 10 * perHour}], 10000, tickMs);
  assert.equal(history.tradePrice(5), 150);
  assert.equal(history.dailyVolume(5), 20 / (30 / 24), 'watched since the oldest trade seen: 30 hours');
  advance(HOUR);
  assert.equal(history.recordTrades(5, [{price: 200, qty: 10, tick: 10000 - 10 * perHour}], 10000 + perHour, tickMs), false, 'the same trade again');
  assert.equal(history.tradePrice(5), 150);
  // A book with no trades starts the watch now: no daily figure for a day.
  history.recordTrades(6, [], 10000, tickMs);
  assert.equal(history.dailyVolume(6), null);
  advance(DAY);
  assert.equal(history.dailyVolume(6), 0, 'a day watched without trades');
});

test('history is saved under its own key, reloads, upgrades version 1, and survives bad storage', () => {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  const values = new Map(), storage = {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v)};
  const clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock, historyStorage: storage});
  const p = player(planner, {lastTick: 10000});
  market.receive({tick: 10000, m: [{t: 'welcome', you: p, orders: []}]});
  market.watch(p, [item], item);
  market.query(p);
  market.receive({tick: 10000, m: [{t: 'marketDepth', itemId: item, bids: [], asks: [], trades: [{price: 300, qty: 4, tick: 9990}]}]});
  assert.ok(values.has(MARKET_HISTORY_KEY));
  assert.ok(!values.has('deepvein-market-v1'), 'the planning ledger is untouched');
  const reloaded = createMarketHistory({now: () => clock});
  reloaded.load(values.get(MARKET_HISTORY_KEY));
  assert.equal(reloaded.tradeMedian(item), 300);
  // Version 1 also held feed samples: its trades and medians are kept.
  const hour = Math.floor(clock / HOUR);
  const old = createMarketHistory({now: () => clock});
  old.load(JSON.stringify({v: 1, feedAt: null, items: {5: {recent: [[hour, 1, 10, 10, 10, 1, 9, 9, 9, 2, 600]], days: [],
    tradeTick: 1, since: clock - HOUR, median: {price: 300, at: clock}}, 6: {recent: [[hour, 1, 10, 10, 10, 0, 0, null, null, 0, 0]], days: []}}}));
  assert.equal(old.tradePrice(5), 300);
  assert.equal(old.tradeMedian(5), 300);
  assert.equal(old.state().items[6], undefined, 'feed samples only: dropped');
  const bad = createMarketHistory({now: () => clock});
  bad.load('{"v":2,"items":{"5":{"recent":[[1,"x"]],"days":[]}}}');
  assert.deepEqual(bad.state().items, {}, 'malformed: start empty');
});
function feedMarket() {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const p = player(planner, {lastTick: 100000, coins: 100000});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const feed = bid => market.setPriceFeed({generatedAt: new Date(clock).toISOString(),
    items: {[item]: {lowestSell: bid * 3, sellQty: 50, highestBuy: bid, buyQty: 500}}});
  return {market, p, item, d, feed, advance: ms => { clock += ms; }};
}

test('a bid spike above the typical bid is valued at the ceiling, never below the merchant', () => {
  const {market, p, item, d, feed, advance} = feedMarket();
  const bid = Math.floor(d.items[item].value * 2);
  for (let i = 0; i < 12; i++) { advance(HOUR); feed(bid); }
  assert.equal(market.opportunity(p, item, 10).net, net(bid, 10), 'an ordinary bid stands');
  feed(bid * 3);
  const ceiling = Math.floor(bid * 1.2);
  assert.ok(ceiling < bid * 3);
  assert.equal(market.opportunity(p, item, 10).net, net(ceiling, 10), 'the spike is capped');
  assert.equal(market.unitValue(p, item, 10), net(ceiling, 10) / 10);
  // A low average cannot pull the value under the merchant price.
  const low = feedMarket(), merchant = Math.floor(low.d.items[low.item].value * .4) * 10;
  for (let i = 0; i < 12; i++) { low.advance(HOUR); low.feed(1); }
  low.feed(Math.floor(low.d.items[low.item].value * 2));
  assert.equal(low.market.opportunity(low.p, low.item, 10).net, merchant);
});

// One listing offers a tenth of a day's turnover at most, so a thin market is
// not flooded (live: gear listed in bulk pushed its own price down).
test('one listing is at most a tenth of a day\'s observed turnover', () => {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  const tick = 1_000_000, perDay = DAY / d.tickMs;
  const list = trades => {
    const market = createMarket(d, planner, {autoSell: true, now: () => 1_000_000_000});
    const p = player(planner, {lastTick: tick, coins: 1000, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null});
    market.receive({tick, m: [{t: 'welcome', you: p, orders: []}]});
    market.watch(p, [item], item);
    assert.deepEqual(market.query(p), {t: 'marketDepth', itemId: item});
    market.receive({tick, m: [{t: 'marketDepth', itemId: item, bids: [], asks: [{price: 999, qty: 5}], trades}]});
    const floor = Math.max(1, Math.floor(d.items[item].value * .4));
    return market.sale(p, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'}).intent;
  };
  // 30 sold over the last three days: 10 a day.
  const intent = list([{price: 900, qty: 10, tick: tick - 3 * perDay}, {price: 900, qty: 20, tick: tick - 2 * perDay}]);
  assert.equal(intent.t, 'marketSell');
  assert.equal(intent.qty, 1, 'a tenth of 10 a day');
  assert.equal(list([]).qty, 1, 'turnover unknown: one at a time');
});

test('history never enters the planning guard, and the page keeps its own copy', () => {
  assert.ok(!('history' in marketGuard({history: {v: 1, items: {}}})));
  const page = {playerId: 1, history: {v: 1, items: {5: 'page'}}}, worker = {playerId: 1, history: {v: 1, items: {}}};
  assert.equal(mergeMarketRuntime(page, worker).history, page.history);
  assert.equal(mergeMarketRuntime(page, {...worker, playerId: 2}).history, page.history);
});
