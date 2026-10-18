import test from 'node:test';
import assert from 'node:assert/strict';
import {hotSkillAt} from '../src/runtime/hot-follow.js';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// Client index-Di-5ljk5.js keeps the rotation of the bundled data: 30-minute
// windows (3000 ticks), the same order, rare skills, seed and hash.
test('the rotation matches the live game: window 13961 is farming +20%', () => {
  const d = makePlanner().data;
  const window = hotSkillAt(d, 13961 * 3000 + 1234);
  assert.equal(window.skill, 'farming');
  assert.equal(window.kind, 'xp');
  assert.equal(window.mult, 1.2);
  assert.equal(window.start, 13961 * 3000);
});

test('a stale snapshot (paused helper) is advanced by the time since it arrived', () => {
  const planner = makePlanner(), d = planner.data, clock = 1e12;
  const t = new Trainer(d, planner, () => {}, () => clock);
  const base = 13961 * 3000 + 100;
  t.player = player(planner, {lastTick: base});
  t.received = clock - 35 * 60000; // 35 minutes without a new state
  const now = hotSkillAt(d, base + Math.floor(35 * 60000 / d.tickMs));
  t.setHotDomSkill(now.skill);
  assert.equal(t.hotFollowValidation, null, 'the game badge for now agrees');
  assert.equal(t.hotFollowStatus().skill, now.skill);
  const stale = hotSkillAt(d, base);
  assert.notEqual(stale.skill, now.skill);
  t.hotMismatchSince = clock - 130000; // a mismatch only counts after 2 minutes
  t.setHotDomSkill(stale.skill);
  assert.deepEqual(t.hotFollowValidation, {expected: now.skill, actual: stale.skill}, 'a real mismatch is still caught');
});
