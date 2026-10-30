import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// A tradable, unprotected crafted good worth something.
function pickItem(d) {
  return d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
}
// One rule, no setting: the day's price (trades seen over 24 hours, else the
// feed's 7-day average) decides. A bid within 5% of it is filled; otherwise
// the batch is listed at it, under the lowest ask.
function setup(_rule, book, {autoSell = true} = {}) {
  const planner = makePlanner(), d = planner.data, item = pickItem(d);
  let clock = 1_000_000;
  const market = createMarket(d, planner, {autoSell, now: () => clock});
  const p = player(planner, {lastTick: 100000, coins: 1000, x: 200, y: 82});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.watch(p, [item], item);
  const query = market.query(p);
  assert.deepEqual(query, {t: 'marketDepth', itemId: item}, 'depth requested for the watched item');
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: item, ...book}]});
  return {market, p, item, d};
}
const recent = (price, qty) => ({price, qty, tick: 99000}); // within the last 2 hours
const net = (price, qty) => price * qty - Math.floor(price * qty * 200 / 10000);

test('output is valued at the listing price when the day trades well above the bid', () => {
  const {market, p, item} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 5}], trades: [recent(149, 200)]});
  const quote = market.opportunity(p, item, 50);
  assert.equal(quote.listed, true);
  assert.equal(quote.net, net(148, 50), 'one price step (2) under the 150 ask, below the day\'s 149');
});

test('a bid near the day\'s price is the valuation and the sale', () => {
  const {market, p, item, d} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 5}], trades: [recent(102, 200)]});
  const quote = market.opportunity(p, item, 50);
  assert.equal(quote.listed, undefined);
  assert.equal(quote.net, net(100, 50));
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(atBank, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'});
  assert.equal(plan.intent.price, 100, 'filled at the bid: the day traded within 5% of it');
});

test('the listing is priced at the day\'s price, under the ask', () => {
  const {market, p, item, d} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 200, qty: 5}], trades: [recent(130, 300)]});
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(atBank, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'});
  assert.equal(plan.intent.t, 'marketSell');
  assert.equal(plan.intent.price, 130, 'the day\'s price, not one step under the 200 ask');
});

test('thin trading or a tiny spread falls back to the bid', () => {
  const thin = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 5}], trades: [recent(149, 10)]});
  assert.equal(thin.market.opportunity(thin.p, thin.item, 50).net, net(100, 50), 'only 10 traded: cannot absorb 50');
  const tight = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 104, qty: 5}], trades: [recent(103, 500)]});
  assert.equal(tight.market.opportunity(tight.p, tight.item, 50).net, net(100, 50), 'ask under 5% above bid');
});

test('without trades seen today, the price feed\'s 7-day average is the day\'s price', () => {
  const {market, p, item, d} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 200, qty: 5}], trades: []});
  market.setPriceFeed({generatedAt: new Date(1_000_000).toISOString(),
    items: {[item]: {lowestSell: 200, sellQty: 5, highestBuy: 100, buyQty: 1000, avg7d: 160}}}, 1_000_000);
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(atBank, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'});
  assert.equal(plan.intent.t, 'marketSell');
  assert.equal(plan.intent.price, 160);
});

test('the sell decision lists when the day trades clearly above the bid', () => {
  const {market, p, item, d} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 5}], trades: [recent(149, 200)]});
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(atBank, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'});
  assert.equal(plan?.intent?.t, 'marketSell', JSON.stringify(plan));
  assert.equal(plan.intent.price, 148);
});

test('everyday selling off: only profit-task output may be listed, and it is valued', () => {
  const {market, p, item, d} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 5}], trades: [recent(149, 200)]}, {autoSell: false});
  assert.equal(market.opportunity(p, item, 50)?.listed, true, 'planning values sales regardless of the setting');
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const vendor = {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y'};
  assert.equal(market.sale(atBank, vendor).intent ?? null, null, 'plain sale refused');
  const plan = market.sale(atBank, {...vendor, profitSale: true});
  assert.equal(plan.intent.t, 'marketSell');
  assert.equal(plan.profitSale, true);
});

test('the merchant price is the floor of every sale valuation', () => {
  const planner = makePlanner(), d = planner.data, item = pickItem(d);
  const market = createMarket(d, planner, {autoSell: false, now: () => 1_000_000});
  const p = player(planner, {lastTick: 100000, coins: 0});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const merchantUnit = Math.max(1, Math.floor(d.items[item].value * .4));
  const unquoted = market.opportunity(p, item, 30);
  assert.deepEqual(unquoted, {net: merchantUnit * 30, qty: 30, merchant: true}, 'no quote yet: merchant value');
  // Bids below the merchant price never beat it.
  const low = setup('list', {bids: [{price: 1, qty: 1000}], asks: [], trades: []});
  const value = low.market.opportunity(low.p, low.item, 30);
  assert.equal(value.merchant, true);
  assert.equal(value.net, Math.max(1, Math.floor(low.d.items[low.item].value * .4)) * 30);
});

test('profit output goes to the merchant when the market cannot beat it', () => {
  const {market, p, item, d} = setup('list', {bids: [], asks: [{price: 999, qty: 5}], trades: []}, {autoSell: false});
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, bank: {[item]: 60}, route: null, path: null};
  const floor = Math.max(1, Math.floor(d.items[item].value * .4));
  const plan = market.sale(atBank, {intent: {t: 'marketDump', itemId: item, qty: 60, floor}, label: 'x', reason: 'y', profitSale: true});
  assert.equal(plan.intent.t, 'marketDump', 'sold to the merchant, not parked as a listing');
  assert.equal(plan.intent.qty, 60);
  assert.equal(plan.profitSale, true);
  // Everyday selling keeps the old rule: list first, merchant only after 2 hours.
  const everyday = setup('list', {bids: [], asks: [{price: 999, qty: 5}], trades: []});
  const atBank2 = {...everyday.p, x: d.banks[0].x, y: d.banks[0].y, bank: {[everyday.item]: 60}, route: null, path: null};
  const listed = everyday.market.sale(atBank2, {intent: {t: 'marketDump', itemId: everyday.item, qty: 60, floor}, label: 'x', reason: 'y'});
  assert.equal(listed.intent.t, 'marketSell');
});

test('a new listing undercuts the queue; stock already held uses up the demand', () => {
  const {market, p, item} = setup('list', {bids: [{price: 100, qty: 1000}], asks: [{price: 150, qty: 180}], trades: [recent(149, 200)]});
  // Listed at 149, ahead of the 180 queued at 150: 200 recent buyers have room.
  assert.equal(market.opportunity(p, item, 50).listed, true);
  // Holding 180 already: only 20 of the recent demand is left for new output.
  const held = {...p, bank: {[item]: 180}};
  assert.equal(market.opportunity(held, item, 50).listed, undefined);
});
