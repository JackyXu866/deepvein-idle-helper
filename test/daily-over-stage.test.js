import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// A smithing stage preparing for days (9,851 greaves) must not shut out the
// dailies: the daily runs at the boundary, the stage is parked with its
// materials reserved, and comes back with its preparation afterwards.
function setup(period) {
  const planner = makePlanner(), d = planner.data, now = 1e9;
  const p = player(planner, {levels: {smithing: 80, fishing: 60}, activity: 'idle', path: null, route: null,
    held: false, queue: [], coins: 0, hp: 100});
  const stage = {skill: 'smithing', target: 85, growth: true, development: true, stage: 85,
    craftPreparation: {jobId: 133, amount: 9851}, budget: {coins: 0, items: {131: 39404}}};
  const quest = {key: `${period}:fish`, id: 'q', period, stamp: 1, kind: 'gather', jobId: 26};
  let open = true;
  planner.questRead = () => open ? [{key: quest.key, period, claimed: false, remaining: 30}] : [];
  planner.questChooseGoal = (_p, _base, _style, deferred) => !open || deferred[quest.key] ? null :
    {skill: 'fishing', target: 61, growth: true, quest, mandatory: true, budget: {coins: 0, items: {}}};
  planner.taskBoundary = () => true;
  planner.harvest = () => null;
  planner.plan = (_state, goal) => ({intent: {t: 'setRoute', siteId: 1, jobId: goal?.quest ? 26 : 133, limit: 0}, label: goal?.skill});
  const t = new Trainer(d, planner, () => {}, () => now);
  Object.assign(t, {mode: 'balanced', style: 'melee', active: true, compatible: true, player: p, autoFallback: false, goal: stage});
  t.issue = next => { t.plan = next; t.issued = next; };
  return {t, stage, close: () => { open = false; }};
}

test('a daily interrupts a long stage preparation, which is parked and resumed', () => {
  const {t, stage, close} = setup('daily');
  t.advance();
  assert.equal(t.goal?.quest?.period, 'daily', 'the daily runs');
  assert.equal(t.waitingGoals.smithing, stage, 'the stage is parked, its materials still reserved');
  close();
  t.goal = null;
  t.chooseGoal = () => ({skill: 'smithing', target: 85, growth: true, budget: {coins: 0, items: {}}});
  t.advance();
  assert.equal(t.goal?.craftPreparation?.amount, 9851, 'the stage resumes with its preparation');
});

test('a weekly still waits for the stage preparation', () => {
  const {t, stage} = setup('weekly');
  t.advance();
  assert.equal(t.goal, stage);
  assert.equal(t.waitingGoals.smithing, undefined);
});
