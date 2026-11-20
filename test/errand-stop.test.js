import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// 2026-11-20: the game warned the account that it operated too often. Each sale
// had stopped the running route at the bank, sold and restarted it. Errands
// now wait for the route's own bank stop, at most once every 30 minutes, and
// every due errand goes in that stop.
function setup() {
  const planner = makePlanner(), d = planner.data;
  const item = d.jobs.map(j => j.output.itemId).find(id => id !== d.coinId && d.items[id]?.value >= 20 && !saleProtectionReason(d, id));
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {autoSell: true, now: () => clock});
  const bank = d.banks[0];
  const at = extra => player(planner, {lastTick: 100000, coins: 1000, x: bank.x, y: bank.y, path: null, bank: {[item]: 500}, ...extra});
  market.receive({tick: 100000, m: [{t: 'welcome', you: at({route: null}), orders: []}]});
  return {market, item, at, advance: ms => { clock += ms; }};
}

test('a working route is never stopped for an errand; its own bank stop is', () => {
  const {market, at, advance} = setup();
  const working = at({route: {jobId: 1, phase: 'working'}, activity: 'working'});
  assert.equal(market.errandOpen(working), false, 'at work, even next to the bank');
  const returned = at({route: {jobId: 1, phase: 'toBank'}, activity: 'banking'});
  assert.equal(market.errandOpen(returned), true, 'the route brought it back');
  const away = at({route: {jobId: 1, phase: 'toBank'}, x: 0, y: 0});
  assert.equal(market.errandOpen(away), false, 'on its way: never walked there for an errand');
});

test('one stop takes every due errand, then none for 30 minutes', () => {
  const {market, at, advance} = setup();
  const idle = at({route: null, activity: 'idle'});
  assert.equal(market.errandOpen(idle), true);
  market.next(idle); // any errand starts the stop
  const runtime = market.runtime();
  runtime.saved.players[idle.id].errandAt = 1_000_000_000;
  market.runtime(runtime);
  advance(5 * 60000);
  assert.equal(market.errandOpen(idle), true, 'within the stop: the rest go too');
  advance(10 * 60000);
  assert.equal(market.errandOpen(idle), false, 'after the stop: wait');
  advance(20 * 60000);
  assert.equal(market.errandOpen(idle), true, '30 minutes since the stop began');
});
