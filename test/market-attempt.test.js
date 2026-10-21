import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// A sale saved as "awaiting confirmation" that the game never carried out:
// the epic Cobalt mortar was converted into house points instead.
function stuck({attempt, bank = {}} = {}) {
  const planner = makePlanner(), d = planner.data;
  let clock = 1_000_000_000;
  const store = new Map();
  const storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  const p = player(planner, {lastTick: 100000, coins: 1_700_000, bank});
  const intent = attempt ?? {t: 'marketSell', itemId: 3383, qty: 1, price: 78999};
  store.set('deepvein-market-v1', JSON.stringify({players: {[p.id]: {owned: {}, income: 0, spent: 0, fillKeys: [],
    attempt: {intent, at: clock - 4 * 86400000, baselineIds: [], revision: 0, before: {id: p.id, coins: p.coins, quantity: 0}, filled: 0}}}}));
  const market = createMarket(d, planner, {now: () => clock, storage});
  market.configureProcurement({enabled: true});
  return {market, p, advance: ms => { clock += ms; }};
}

test('a market attempt the game never carried out is released after a fresh order list', () => {
  const {market, p} = stuck();
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.next(p);
  assert.ok(market.purchaseAllowance(p) > 0);
  assert.equal(market.runtime().saved.players[p.id].attempt, null, 'trading is no longer blocked');
});

test('a buy that brought the goods is not released as never carried out', () => {
  const {market, p} = stuck({attempt: {t: 'marketBuy', itemId: 3363, qty: 1, price: 67000}, bank: {3363: 1}});
  // Goods arrived but no coins left the ledger here: neither confirmed nor never-done.
  market.receive({tick: 100000, m: [{t: 'welcome', you: {...p, coins: p.coins + 1}, orders: []}]});
  market.next({...p, bank: {3363: 1}});
  assert.notEqual(market.runtime().saved.players[p.id].attempt, null);
});
