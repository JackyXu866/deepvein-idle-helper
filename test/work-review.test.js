import test from 'node:test';
import assert from 'node:assert/strict';
import {WORK_REVIEW_SECONDS, noteChoice, reviewDue} from '../src/planner/strategy.js';

// 2026-11-20: what to work on is reviewed every two hours (daily quests still
// interrupt at once); between reviews the running choice stays.
test('a work choice is held until the review, and a new choice restarts its clock', () => {
  const data = {tickMs: 600}, ticks = s => s * 1000 / data.tickMs;
  const goal = {};
  const p = {lastTick: 1000};
  assert.equal(WORK_REVIEW_SECONDS, 7200);
  assert.equal(reviewDue(data, p, goal, 'mining'), true, 'never chosen: choose now');
  noteChoice(p, goal, 'mining', true);
  assert.equal(reviewDue(data, {lastTick: 1000 + ticks(600)}, goal, 'mining'), false, 'ten minutes in: held');
  assert.equal(reviewDue(data, {lastTick: 1000 + ticks(7199)}, goal, 'mining'), false);
  noteChoice({lastTick: 1000 + ticks(3600)}, goal, 'mining', false);
  assert.equal(goal.choiceTicks.mining, 1000, 'the same choice keeps its clock');
  assert.equal(reviewDue(data, {lastTick: 1000 + ticks(7200)}, goal, 'mining'), true, 'two hours: reviewed');
  assert.equal(reviewDue(data, p, goal, 'combat'), true, 'each kind of choice has its own clock');
});
