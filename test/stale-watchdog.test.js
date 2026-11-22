import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// 2026-11-21: with a state sync every 60 s (v0.16.0) and a 45 s watchdog, the
// helper paused and restarted itself every minute while working quietly.
test('quiet work between syncs is not taken for a lost connection', () => {
  const planner = makePlanner();
  let clock = 1_000_000;
  const t = new Trainer(planner.data, planner, () => {}, () => clock);
  const p = player(planner, {lastTick: 1000, route: {jobId: 1, siteId: 1, phase: 'working'}, activity: 'working'});
  Object.assign(t, {active: true, compatible: true, player: p, received: clock, awaitInitial: false,
    snapshotSequence: 1, syncAfter: 1, nextSync: clock + 60000, nextAction: clock + 60000});
  clock += 70000;
  t.tick();
  assert.equal(t.active, true, '70 s without a frame, past the 60 s sync: still running');
  assert.equal(t.recovery, null);
  clock += 30000;
  t.tick();
  assert.equal(t.active, false, 'past a sync and a half: out of step, so it re-syncs');
  assert.ok(t.recovery);
});
