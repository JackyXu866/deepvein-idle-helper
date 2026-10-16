import test from 'node:test';
import assert from 'node:assert/strict';
import {guardChange, inputFields, planningGuard} from '../src/worker/planning.js';

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

test('a real change discards the result and names what changed', () => {
  const state = page(), before = guard(state);
  state.trainer.player = {...state.trainer.player, bank: {5: 4}};
  assert.equal(guardChange(before, guard(state)), '调度状态 · player.bank');
  const again = page(), start = guard(again);
  again.market.set({orders: [1]});
  assert.equal(guardChange(start, guard(again)), '市场');
});
