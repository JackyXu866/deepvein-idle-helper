import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// After a market error the helper has stopped the route at the bank; the
// game's own fallback does not start after a stop, so the helper must.
function setup(extra = {}) {
  const planner = makePlanner(), d = planner.data, sent = [];
  const t = new Trainer(d, planner, intent => sent.push(intent), () => 5e9);
  t.compatible = true; t.active = true; t.mode = 'balanced'; t.style = 'melee';
  t.player = {...player(planner, {levels: {mining: 20}, route: null, path: null, activity: 'idle', held: false}), id: 1, ...extra};
  return {t, sent, d};
}

test('an error pause starts a gathering job when the character is idle', () => {
  const {t, sent, d} = setup();
  t.pauseError('服务器拒绝操作：market-price-step');
  assert.equal(t.active, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'setRoute');
  assert.equal(d.jobs.find(j => j.id === sent[0].jobId).skill, 'mining');
  assert.match(t.pausedError.reason, /market-price-step/);
  assert.ok(t.pausedError.backup);
});

test('no backup when the character is busy, for plain pauses, or inside the Worker', () => {
  const busy = setup({route: {jobId: 1, siteId: 1, phase: 'working'}});
  busy.t.pauseError('x');
  assert.equal(busy.sent.length, 0);
  assert.ok(busy.t.pausedError, 'the error is still shown');
  const plain = setup();
  plain.t.pause('已选择新职业');
  assert.equal(plain.sent.length, 0);
  assert.equal(plain.t.pausedError, null);
  const worker = setup();
  worker.t.inWorker = true;
  worker.t.pauseError('x');
  assert.equal(worker.sent.length, 0, 'the page starts it after applying the result');
  assert.equal(worker.t.pausedError.backup, null);
  worker.t.inWorker = false;
  worker.t.startBackup();
  assert.equal(worker.sent.length, 1);
});

test('an error pause restarts by itself, waiting longer for each error in a row; pausing by hand cancels it', () => {
  const planner = makePlanner();
  let clock = 5e9;
  const t = new Trainer(planner.data, planner, () => {}, () => clock);
  t.compatible = true; t.mode = 'balanced'; t.style = 'melee';
  t.player = {...player(planner, {levels: {mining: 20}, route: {jobId: 1, siteId: 1, phase: 'working'}, path: null, held: false}), id: 1};
  const waits = [];
  for (let i = 0; i < 6; i++) {
    t.active = true;
    t.pauseError('x');
    waits.push((t.pausedError.retryAt - clock) / 60000);
    assert.equal(t.retryAfterError(), false, 'not before its time');
    clock = t.pausedError.retryAt;
    assert.equal(t.retryAfterError(), true);
    assert.equal(t.active, true);
    assert.equal(t.pausedError, null);
  }
  assert.deepEqual(waits, [2, 5, 10, 20, 30, 30]);
  // Half an hour of running after a restart starts the count again.
  clock += 30 * 60000;
  t.pauseError('x');
  assert.equal((t.pausedError.retryAt - clock) / 60000, 2);
  t.pause();
  clock += 3600000;
  assert.equal(t.retryAfterError(), false, 'a pause by hand stays');
});

test('an unknown refusal of our command syncs, sets the goal aside and does not pause; one not ours is only noted', () => {
  const planner = makePlanner(), clock = 5e9;
  const t = new Trainer(planner.data, planner, () => {}, () => clock);
  const p = player(planner, {levels: {mining: 20}});
  Object.assign(t, {active: true, compatible: true, player: p, snapshotTick: 100, snapshotSequence: 1, received: clock, nextSync: clock + 60000,
    goal: {skill: 'mining', target: 21}, pending: {intent: {t: 'setRoute', jobId: 1, siteId: 1}, label: '采矿', before: p, sentAt: clock}});
  t.receive({tick: 101, m: [{t: 'error', code: 'brand-new-code'}]});
  assert.equal(t.active, true);
  assert.equal(t.pausedError ?? null, null);
  t.snapshotSequence = 2;
  t.tick();
  assert.equal(t.active, true);
  assert.equal(t.goal, null);
  assert.ok(t.deferred.mining > clock, 'the goal rests');
  t.receive({tick: 102, m: [{t: 'error', code: 'guild-something-else'}]});
  assert.equal(t.active, true);
  assert.match(t.history[0].message, /不是助手发出的操作/);
});

test('starting again clears the error', () => {
  const {t} = setup();
  t.pauseError('x');
  t.awaitInitial = false;
  t.start?.();
  assert.equal(t.pausedError, null);
});
