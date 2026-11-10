import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

function setup() {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  planner.coinRate = () => 10;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const p = player(planner, {lastTick: 100000, coins: 100000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const feed = rows => ({generatedAt: new Date(clock).toISOString(), refreshSeconds: 300, items: rows});
  return {market, p, item, d, feed, advance: ms => { clock += ms; }};
}
const net = (price, qty) => price * qty - Math.floor(price * qty * 200 / 10000);

test('without a live book, sales are valued at the feed bid its buyers can take', () => {
  const {market, p, item, d, feed} = setup();
  const merchant = Math.floor(d.items[item].value * .4) * 10;
  assert.equal(market.opportunity(p, item, 10).net, merchant, 'no feed: merchant');
  const bid = Math.floor(d.items[item].value * 2);
  assert.equal(market.setPriceFeed(feed({[item]: {lowestSell: bid * 2, sellQty: 50, highestBuy: bid, buyQty: 500}})), true);
  const value = market.opportunity(p, item, 10);
  assert.equal(value.net, net(bid, 10));
  assert.equal(value.feed, true);
  market.setPriceFeed(feed({[item]: {lowestSell: bid * 2, sellQty: 50, highestBuy: bid, buyQty: 5}}));
  assert.equal(market.opportunity(p, item, 10).net, merchant, 'buyers cannot take 10');
});

test('quality gear with no market price in a fresh feed cannot be sold; without a feed that is unknown', () => {
  const {market, p, d, feed, advance} = setup();
  const bow = d.items[140] ? 140 + d.rarityScale : null, common = 140;
  assert.ok(bow);
  assert.equal(market.saleable(p, bow), true, 'no feed: assumed sellable');
  market.setPriceFeed(feed({[common]: {lowestSell: 30, sellQty: 5, avg7d: 20, vol7d: 100}}));
  assert.equal(market.saleable(p, bow), false, 'nobody trades the uncommon one');
  assert.equal(market.saleable(p, common), true, 'the common one still goes to the merchant');
  market.setPriceFeed(feed({[bow]: {lowestSell: 300, sellQty: 5, avg7d: 250, vol7d: 50}}));
  assert.equal(market.saleable(p, bow), true, 'traded: sellable');
  advance(16 * 60000);
  assert.equal(market.saleable(p, bow), true, 'a stale feed proves nothing');
});

test('nothing the game shop sells is worth more than the shop asks', () => {
  const {market, p, d, feed} = setup();
  const seed = 160, shop = d.items[seed].value * 4;
  market.setPriceFeed(feed({[seed]: {lowestSell: null, sellQty: 0, highestBuy: 1, buyQty: 985569, avg7d: 115503, vol7d: 3031},
    10: {lowestSell: 146, sellQty: 96792, highestBuy: 102, buyQty: 6260, avg7d: 112, vol7d: 351635}}));
  assert.ok(market.unitValue(p, seed) <= shop - Math.floor(shop * 200 / 10000), 'a wash-traded average is capped at the shop (the bid of 1 caps it lower still)');
  assert.equal(market.unitValue(p, 10), 112 - Math.floor(112 * 200 / 10000), 'logs keep their market price');
});

test('a stale or far-off feed is ignored', () => {
  const {market, p, item, d, feed, advance} = setup();
  const bid = Math.floor(d.items[item].value * 2);
  market.setPriceFeed(feed({[item]: {lowestSell: null, sellQty: 0, highestBuy: bid, buyQty: 500}}));
  advance(16 * 60000);
  assert.equal(market.opportunity(p, item, 10).feed, undefined, 'older than 15 minutes');
  assert.equal(market.setPriceFeed({generatedAt: '2020-01-01T00:00:00Z', items: {}}), false, 'an old cached copy');
});

test('buy-vs-make reads the feed ask, and an order still waits for the live book', () => {
  const {market, p, item, feed} = setup();
  assert.equal(market.marketBuyPrice(p, item, 5), Infinity, 'unknown price');
  market.setPriceFeed(feed({[item]: {lowestSell: 300, sellQty: 50, highestBuy: null, buyQty: 0}}));
  assert.equal(market.marketBuyPrice(p, item, 5), 300, 'the feed ask');
  assert.equal(market.marketBuyPrice(p, item, 60), Infinity, 'not enough on sale');
  const plan = market.purchase(p, item, 5, {horizon: 3600, budget: {coins: 0, items: {}}});
  assert.notEqual(plan?.intent?.t, 'marketBuy', 'no order from feed prices alone');
  assert.deepEqual(market.query(p), {t: 'marketDepth', itemId: item}, 'the live book is requested first');
});

test('the equipment scan takes candidates from the feed without queuing book queries', () => {
  const {market, p, d, feed} = setup();
  const gear = d.gear.find(g => g.slot === 'helmet').itemId;
  market.setPriceFeed(feed({[gear]: {lowestSell: 5000, sellQty: 2, highestBuy: null, buyQty: 0}, [gear + d.rarityScale]: {lowestSell: null, sellQty: 0, highestBuy: 10, buyQty: 1}}));
  const found = market.watchPurchases(p, [gear, gear + d.rarityScale, gear + 2 * d.rarityScale]);
  assert.deepEqual(found.map(f => [f.itemId, f.ask]), [[gear, 5000]]);
  const q = market.query(p);
  assert.ok(!q || q.t !== 'marketBooks' || q.itemIds.every(id => id === gear + 2 * d.rarityScale), JSON.stringify(q));
});

test('a deep pile of cheaper asks is the market: the listing follows it; a thin one is ignored', () => {
  const sell = askQty => {
    const {market, p, item, d, feed} = setup();
    market.setPriceFeed(feed({[item]: {lowestSell: 700, sellQty: askQty, avg7d: 1000, vol7d: 700}}));
    market.watch(p, [item], item);
    market.query(p);
    market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: item, bids: [], asks: [{price: 700, qty: askQty}], trades: []}]});
    const floor = Math.floor(d.items[item].value * .4);
    return market.sale({...p, bank: {[item]: 300}}, {intent: {t: 'marketDump', itemId: item, qty: 300, floor}, label: 'x', reason: 'y', profitSale: true});
  };
  // A day's turnover is 100: 500 cheaper units sell first for five days.
  assert.ok(sell(500).intent.price < 700, JSON.stringify(sell(500).intent));
  assert.equal(sell(5).intent.price, 900, 'five cheap units: kept at 90% of the market price');
});
