import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// The game refuses market orders from an account with no verified email
// (email-needed). The market then counts as closed, as for an ironman: no
// buy price, no ask, no sale, no query; kept across a reload; never a pause.
function setup() {
  const planner = makePlanner(), d = planner.data, store = {};
  const storage = {getItem: k => store[k] ?? null, setItem: (k, v) => {store[k] = v;}};
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock, storage});
  market.configureProcurement({enabled: true});
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar').output.itemId;
  const p = {...player(planner, {lastTick: 100000, coins: 1_000_000, levels: {smithing: 20}, x: d.banks[0].x, y: d.banks[0].y, path: null}), id: 7};
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.watch(p, [bar], bar);
  market.query(p);
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: bar, bids: [{price: 40, qty: 500}], asks: [{price: 50, qty: 500}], trades: []}]});
  return {planner, d, market, p, bar, storage, advance: ms => {clock += ms;}, now: () => clock};
}

test('email-needed closes the market for that character, as for an ironman', () => {
  const {market, p, bar} = setup();
  assert.equal(market.askPrice(p, bar), 50);
  assert.equal(market.marketBuyPrice(p, bar, 10), 50);
  market.rejected('email-needed');
  assert.equal(market.closed(p), true);
  assert.equal(market.askPrice(p, bar), null, 'nothing is planned as bought');
  assert.equal(market.marketBuyPrice(p, bar, 10), Infinity);
  assert.equal(market.purchaseAllowance(p), 0);
  assert.equal(market.opportunity(p, bar, 10), null, 'nothing is valued as sold on the market');
  assert.equal(market.query(p), null, 'no market queries');
  assert.equal(market.sale(p, null)?.marketDeferred, true);
  assert.match(market.sale(p, null).reason, /验证过的邮箱/);
  assert.equal(market.closed({...p, id: 8}), false, 'another character is not affected');
});

test('the closed market is remembered across a reload and tried again after six hours', () => {
  const {d, planner, market, p, storage, advance, now} = setup();
  market.rejected('email-needed');
  const reloaded = createMarket(d, planner, {now, storage});
  reloaded.receive({tick: 100002, m: [{t: 'snapshot', you: p, orders: []}]});
  assert.equal(reloaded.closed(p), true);
  advance(6 * 3600000 + 1);
  assert.equal(reloaded.closed(p), false);
});

test('the game reporting the email verified opens it at once', () => {
  const {market, p} = setup();
  market.rejected('email-needed');
  market.receive({tick: 100002, m: [{t: 'emailVerified'}]});
  assert.equal(market.closed(p), false);
});

test('the refusal never pauses the helper', () => {
  const {planner, d, market, p, bar} = setup();
  const t = new Trainer(d, planner, () => {}, () => 5e9);
  t.market = market; t.compatible = true; t.active = true; t.player = p; t.snapshotTick = 100001;
  t.pending = {intent: {t: 'marketSell', itemId: bar, qty: 10, price: 40}, label: '出售', sentAt: 5e9, before: p};
  t.receive({tick: 100002, m: [{t: 'error', code: 'email-needed'}]});
  assert.equal(t.active, true);
  assert.equal(t.pausedError ?? null, null);
  assert.equal(t.pending, null, 'the refused order is dropped');
  assert.equal(market.closed(p), true);
  assert.match(t.message, /验证过的邮箱/);
});
