import test from 'node:test';
import assert from 'node:assert/strict';
import {guardChange, inputFields, mergeMarketRuntime, planningGuard} from '../src/worker/planning.js';

function page() {
  const trainer = Object.fromEntries(inputFields.map(key => [key, null]));
  Object.assign(trainer, {player: {id: 1, lastTick: 10, bank: {5: 3}}, goal: {skill: 'crafting'}, message: '正在收获补种',
    pending: null, recovery: null, awaitInitial: false, boss: {status: () => ({phase: 'idle'})}});
  const planner = {farmingPreference: () => ({mode: 'auto'}), housingRuntime: () => ({})};
  let market = {orders: []};
  return {trainer, planner, market: {runtime: () => market, set: m => { market = m; }}};
}
const guard = ({trainer, planner, market}) => planningGuard(trainer, planner, market, {});

test('a status annotation made while the Worker computes does not discard its result', () => {
  const state = page(), before = guard(state);
  state.trainer.message += '；本场 Boss 跳过：唯一可用食物是目标物品';
  assert.equal(guardChange(before, guard(state)), null);
  state.trainer.player = {...state.trainer.player, lastTick: 11};
  assert.equal(guardChange(before, guard(state)), null, 'a heartbeat alone changes nothing');
});

test('the Boss countdown ticking does not discard results; crossing the five-minute mark does', () => {
  const state = page();
  let nextIn = 900;
  state.trainer.boss = {status: () => ({phase: 'watching', nextIn})};
  const before = guard(state);
  nextIn = 899;
  assert.equal(guardChange(before, guard(state)), null, 'one second later');
  const near = (nextIn = 301, guard(state));
  nextIn = 299;
  assert.equal(guardChange(near, guard(state)), '世界 Boss', 'now within five minutes: house trips are off');
});

test('a real change discards the result and names what changed', () => {
  const state = page(), before = guard(state);
  state.trainer.player = {...state.trainer.player, bank: {5: 4}};
  assert.equal(guardChange(before, guard(state)), '调度状态 · player.bank');
  const again = page(), start = guard(again);
  again.market.set({orders: [1]});
  assert.equal(guardChange(start, guard(again)), '市场');
});

test('price refreshes and quote bookkeeping made while planning do not discard a result', () => {
  const state = page(), before = guard(state);
  state.market.set({orders: [], quotes: new Map([[5, {at: 2, asks: [{price: 9, qty: 1}]}]]), tops: new Map([[5, {ask: 9, at: 2}]]),
    feed: {at: 2, items: {5: {ask: 9}}}, requests: new Map([[7, {at: 3}]]), bookRequests: new Map([[8, {}]]),
    need: {itemId: 5, qty: 1, at: 4}, status: '比较买成品', equipmentScan: {startedAt: 5}, lastQuery: 6, watched: [5]});
  assert.equal(guardChange(before, guard(state)), null);
  state.market.set({orders: [], saved: {attempt: {itemId: 5}}});
  assert.equal(guardChange(before, guard(state)), '市场', 'a pending market attempt still discards');
});

test('applying a Worker result keeps the quotes that reached the page meanwhile', () => {
  const worker = {playerId: 1, status: '比价', quotes: new Map([[5, {at: 10, asks: []}]]), tops: new Map(),
    requests: new Map([[5, {at: 9, sentAt: null}], [6, {at: 9, sentAt: null}]]), bookRequests: new Map([[7, {sentAt: null}]]),
    feed: {at: 1, items: {}}, lastQuery: 9, lastSync: 0};
  const page = {playerId: 1, quotes: new Map([[5, {at: 20, asks: [{price: 3, qty: 1}]}], [8, {at: 21, asks: []}]]),
    tops: new Map([[6, {ask: 4, at: 22}]]), requests: new Map(), bookRequests: new Map([[7, {sentAt: 15}]]),
    feed: {at: 5, items: {}}, lastQuery: 18, lastSync: 0};
  const merged = mergeMarketRuntime(page, worker);
  assert.equal(merged.status, '比价', 'what planning decided is kept');
  assert.equal(merged.quotes.get(5).at, 20, 'the newer quote wins');
  assert.ok(merged.quotes.has(8), 'a quote that arrived during planning stays');
  assert.equal(merged.requests.size, 0, 'queries the page already answered are not asked again');
  assert.equal(merged.bookRequests.get(7).sentAt, 15, 'a query the page sent stays sent');
  assert.equal(merged.feed.at, 5);
  assert.equal(merged.lastQuery, 18);
});
