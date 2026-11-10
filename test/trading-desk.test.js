import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// The trading desk: buy below the market price and resell as the sale rule
// sells (95% of the market price after tax, a tenth of a day's turnover at a
// time). Thin markets and absurd margins are never traded.
function desk(row) {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 100;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: false, now: () => clock});
  const p = player(planner, {lastTick: 100000, coins: 1_000_000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null, activity: 'idle'});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.configureProcurement({enabled: true});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {[item]: row}}, clock);
  return {market, planner, d, p, item, depth: (asks, tick = 100001) =>
    market.receive({tick, m: [{t: 'marketDepth', itemId: item, bids: [], asks, trades: []}]})};
}
const liquid = {lowestSell: 100, sellQty: 50, highestBuy: 80, buyQty: 10, avg7d: 150, vol7d: 7000};

test('a listing well under the market price of a liquid item is a trade; thin or absurd ones are not', () => {
  const ok = desk(liquid);
  const [row] = ok.market.tradeRows(ok.p);
  assert.equal(row?.kind, 'flip');
  assert.equal(row.qty, 50, 'all 50 on offer: under a tenth of the 1000 a day');
  assert.ok(row.unit > 10, 'resold at 95% of 150 after tax, bought at 100');
  const thin = desk({...liquid, vol7d: 3});
  assert.equal(thin.market.tradeRows(thin.p).length, 0, 'three trades a week prove no price');
  const absurd = desk({...liquid, avg7d: 100000});
  assert.equal(absurd.market.tradeRows(absurd.p).length, 0, 'an average a thousand times the ask is a freak trade, not a price');
});

test('a week\'s average more than twice the lowest ask is a freak trade: the ask stands in', () => {
  // 2026-11-09: a Voidmelon seed (yew's bonus drop) averaged 1,061,038 while asked at 1,800.
  const seed = desk({lowestSell: 1800, sellQty: 3, highestBuy: null, buyQty: 0, avg7d: 1061038, vol7d: 68});
  assert.ok(seed.market.unitValue(seed.p, seed.item, 1) <= 1800, 'valued at the ask at most, not the average');
  const fair = desk({...liquid, lowestSell: 100, avg7d: 190});
  assert.ok(fair.market.unitValue(fair.p, fair.item, 1) > 150, 'within twice the ask: the average (190, less tax) stands');
});

test('the desk buys at a stop, then lists the goods by the sale rule, even with everyday selling off', () => {
  const {market, p, item, depth} = desk(liquid);
  assert.equal(market.next(p)?.intent, null, 'first the live book');
  depth([{price: 100, qty: 50}, {price: 160, qty: 20}]);
  const plan = market.next(p);
  assert.deepEqual(plan?.intent, {t: 'marketBuy', itemId: item, qty: 50, price: 100});
  assert.equal(plan.trade.kind, 'flip');
  market.issued(p, plan.intent, plan);
  // Bought: the 50 are in the bank and the next step lists them.
  const after = {...p, lastTick: 100010, coins: p.coins - 5000, bank: {...p.bank, [item]: 50}};
  market.receive({tick: 100010, m: [{t: 'snapshot', you: after, orders: []}]});
  market.next(after);
  depth([{price: 160, qty: 20}], 100011);
  const sale = market.next(after);
  assert.equal(sale?.intent?.t, 'marketSell', JSON.stringify(sale));
  assert.equal(sale.profitSale, true, 'sold although everyday selling is off');
  assert.ok(sale.intent.price >= 135, `listed at no less than 90% of 150: ${sale.intent.price}`);
});

test('no buy when cheap sellers would be left under the resale price', () => {
  const {market, p, depth} = desk(liquid);
  market.next(p);
  depth([{price: 100, qty: 50}, {price: 110, qty: 500}]);
  assert.equal(market.next(p)?.intent?.t, undefined, '500 more under 135: the resale would be undercut');
});

test('a piece worth more at +N is bought, then enhanced one step at a time toward it', () => {
  const planner = makePlanner(), d = planner.data, P = d.plusScale;
  planner.coinRate = () => 100;
  const blade = d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name.startsWith('Cobalt blade')).itemId;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: false, now: () => clock});
  const p = player(planner, {lastTick: 100000, coins: 10_000_000, x: d.banks[0].x, y: d.banks[0].y, route: null, path: null, activity: 'idle',
    levels: {enhancing: 60}, bank: {[d.shardId]: 5000}});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.configureProcurement({enabled: true});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {
    [blade]: {lowestSell: 1000, sellQty: 5, avg7d: 1200, vol7d: 70},
    [blade + 3 * P]: {avg7d: 60000, vol7d: 70}}}, clock);
  const row = market.tradeRows(p).find(r => r.kind === 'enhance');
  assert.equal(row?.toPlus, 3, JSON.stringify(market.tradeRows(p)));
  market.next(p);
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: blade, bids: [], asks: [{price: 1000, qty: 5}], trades: []}]});
  const plan = market.next(p);
  assert.deepEqual(plan?.intent, {t: 'marketBuy', itemId: blade, qty: 1, price: 1000});
  market.issued(p, plan.intent, plan);
  const after = {...p, lastTick: 100010, coins: p.coins - 1000, bank: {...p.bank, [blade]: 1}};
  market.receive({tick: 100010, m: [{t: 'snapshot', you: after, orders: []}]});
  market.next(after);
  assert.deepEqual(market.next(after)?.intent, {t: 'enhance', itemId: blade, toPlus: 1, once: true}, 'enhanced beside the work');
});
