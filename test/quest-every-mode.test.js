import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// Dailies and weeklies are mandatory in every mode: 补精通 does them before its
// collections, and assist mode does them and then restarts the player's route.
function setup(mode, route = null) {
  const planner = makePlanner(), d = planner.data, now = 1e9;
  const p = player(planner, {levels: {fishing: 60, mining: 60}, activity: route ? 'work' : 'idle', path: null, route,
    held: false, queue: [], coins: 0, hp: 100});
  const quest = {key: 'daily:fish', id: 'q', period: 'daily', stamp: 1, kind: 'gather', jobId: 26};
  let open = true;
  planner.questRead = () => open ? [{key: quest.key, period: 'daily', claimed: false, remaining: 30}] : [];
  planner.questChooseGoal = (_p, _base, _style, deferred) => !open || deferred[quest.key] ? null :
    {skill: 'fishing', target: 61, growth: true, quest, mandatory: true, horizon: 1800, reason: '必做每日任务', budget: {coins: 0, items: {}}};
  planner.questCompleted = () => !open;
  planner.questClaim = () => null;
  planner.questReroll = () => null;
  planner.masteryPurchase = () => null;
  planner.taskBoundary = () => true;
  planner.harvestOnly = () => null;
  planner.housingPlan = () => null;
  planner.maintenance = () => null;
  planner.masteryChooseGoal = () => ({skill: 'mining', mastery: {itemId: 1}, recipeId: 1, reason: '补精通：矿石'});
  planner.masteryCompleted = () => false;
  planner.masterySkipped = () => false;
  planner.masteryForge = () => null;
  planner.plan = (_state, goal) => ({intent: {t: 'setRoute', siteId: 1, jobId: goal?.quest ? 26 : 1, limit: 30}, label: goal?.skill});
  const t = new Trainer(d, planner, () => {}, () => now);
  Object.assign(t, {mode, style: 'melee', active: true, compatible: true, player: p, autoFallback: false});
  t.consume = () => null;
  t.watchProgress = () => false;
  t.issue = next => { t.plan = next; t.issued = next; };
  return {t, close: () => { open = false; }};
}

test('补精通 does the daily before its collections', () => {
  const {t, close} = setup('mastery');
  t.advance();
  assert.equal(t.goal?.quest?.period, 'daily');
  assert.equal(t.issued.intent.jobId, 26, 'the quest route runs');
  close();
  t.advance();
  assert.ok(t.goal?.mastery, 'back to the collections once the daily is done');
  assert.equal(t.issued.intent.jobId, 1);
});

test('assist mode does the daily, then restarts the player\'s own route', () => {
  const own = {jobId: 7, siteId: 3, limit: 0, onFull: 'bank', phase: 'work'};
  const {t, close} = setup('assist', own);
  assert.equal(t.drives(), false, 'before a quest the player drives');
  t.advance();
  assert.equal(t.goal?.quest?.period, 'daily');
  assert.equal(t.drives(), true, 'while the quest runs the helper drives');
  assert.equal(t.issued.intent.jobId, 26);
  close();
  t.advance();
  assert.equal(t.goal, null);
  assert.deepEqual([t.issued.intent.t, t.issued.intent.jobId, t.issued.intent.siteId], ['setRoute', 7, 3], 'the player\'s route is back');
  assert.equal(t.assistResume, null, 'restarted once');
});

test('assist mode leaves a player\'s queue alone', () => {
  const {t} = setup('assist');
  t.player.queue = [{jobId: 7}];
  t.advance();
  assert.equal(t.goal, null);
});
