import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

function setup(active) {
  const planner = makePlanner(), sent = [];
  const t = new Trainer(planner.data, planner, intent => sent.push(intent), () => 5e9);
  t.compatible = true; t.active = active; t.style = 'melee';
  t.player = {...player(planner, {route: null, path: null, activity: 'idle', held: false}), id: 1};
  return t;
}

test('a running helper waits for the reconnect and keeps its place', () => {
  const t = setup(true);
  t.connectionLost();
  assert.equal(t.active, false);
  assert.equal(t.recovery.playerId, 1, 'the same character resumes on its welcome');
  assert.match(t.message, /连上后自动继续/);
});

test('a drop while stopped keeps the reason it stopped', () => {
  const t = setup(false);
  t.log('已同步，可开始收益规划');
  t.connectionLost();
  assert.equal(t.recovery, null);
  assert.equal(t.message, '已同步，可开始收益规划', 'the drop is not shown as the cause');
  assert.equal(t.awaitingWelcome, true);
});

test('a rate limit (too-fast) slows the helper down instead of pausing it', async () => {
  const {isRateRefusal} = await import('../src/runtime/trainer.js');
  assert.equal(isRateRefusal('too-fast'), true);
  assert.equal(isRateRefusal('chat-too-fast'), true);
  assert.equal(isRateRefusal('not-at-bank'), false);
  const t = setup(true);
  t.snapshotTick = 100;
  t.pending = {intent: {t: 'setRoute', jobId: 1, siteId: 1}, label: '采矿', sentAt: 5e9, before: t.player};
  t.receive({tick: 101, m: [{t: 'error', code: 'too-fast'}]});
  assert.equal(t.active, true, 'still running');
  assert.equal(t.pausedError ?? null, null);
  assert.equal(t.pending, null, 'the dropped command is planned again');
  assert.ok(t.nextAction >= 5e9 + 10000, 'after a short rest');
});

test('a refused connection still says why', () => {
  const t = setup(true);
  t.connectionLost('角色已在别处登录，已取消自动恢复');
  assert.equal(t.recovery, null);
  assert.match(t.message, /别处登录/);
});
