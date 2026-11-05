import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// Dailies and weeklies are mandatory in every mode: 补精通 does them before its
// collections; assist mode does them beside the player's own work and queue.
const OWN = {zoneId: null, siteId: 46, jobId: 45, onFull: 'bank', limit: null, phase: 'toWork'};
const QUEUED = {kind: 'job', siteId: 23, jobId: 8, onFull: 'bank', limit: null, rarity: 0};
function setup(mode, extra = {}) {
  const planner = makePlanner(), d = planner.data, now = 1e9;
  const p = player(planner, {levels: {fishing: 60, mining: 60}, activity: 'idle', path: null, route: null,
    held: false, queue: [], queueSlots: 2, coins: 0, hp: 100, ...extra});
  const quest = {key: 'daily:cook', id: 'q', period: 'daily', stamp: 1, kind: 'craft', jobId: 26};
  const state = {open: true, supplied: false};
  planner.questRead = () => state.open ? [{key: quest.key, period: 'daily', claimed: false, remaining: 15}] : [];
  planner.questChooseGoal = (_p, _base, _style, deferred) => !state.open || deferred[quest.key] ? null :
    {skill: 'cooking', target: 61, growth: true, quest, mandatory: true, horizon: 1800, reason: '必做每日任务', budget: {coins: 0, items: {}}};
  planner.questCompleted = () => !state.open;
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
  // The quest's raw inputs are fished first (job 99), then it is cooked (job 26).
  planner.plan = (_state, goal) => ({intent: {t: 'setRoute', siteId: 1, jobId: goal?.quest ? state.supplied ? 26 : 99 : 1, limit: 15},
    label: goal?.skill});
  const t = new Trainer(d, planner, () => {}, () => now);
  Object.assign(t, {mode, style: 'melee', active: true, compatible: true, player: p, autoFallback: false});
  t.consume = () => null;
  t.watchProgress = () => false;
  t.issue = next => { t.plan = next; t.issued = next; };
  return {t, p, state};
}

test('补精通 does the daily before its collections', () => {
  const {t, state} = setup('mastery');
  t.advance();
  assert.equal(t.goal?.quest?.period, 'daily');
  assert.equal(t.issued.intent.jobId, 99, 'the quest\'s supply runs');
  state.open = false;
  t.advance();
  assert.ok(t.goal?.mastery, 'back to the collections once the daily is done');
  assert.equal(t.issued.intent.jobId, 1);
});

// Live: the player had their own work and one more job queued, and the dailies
// were never done. As the game's "keep my task": the work is set aside to the
// front of the queue before the quest's supply, and the quest itself starts
// with goQuest, after which the game carries on with the queue.
test('assist mode supplies and does a quest beside the player\'s work and queue', () => {
  const {t, p, state} = setup('assist', {route: OWN, queue: [QUEUED]});
  t.advance();
  assert.equal(t.issued.intent.t, 'setAside', 'the player\'s work goes to the front of their queue first');
  assert.equal(t.drives(), false, 'their queue is not a reason to stop');
  Object.assign(p, {route: null, held: true, queue: [{kind: 'job', ...OWN}, QUEUED]});
  t.advance();
  assert.deepEqual([t.issued.intent.t, t.issued.intent.jobId], ['setRoute', 99], 'then the supply');
  Object.assign(p, {route: {zoneId: null, siteId: 1, jobId: 99, limit: 15, onFull: 'bank'}, held: false});
  state.supplied = true;
  t.advance();
  assert.deepEqual(t.issued.intent, {t: 'goQuest', id: 'q'}, 'the helper\'s own supply route is not set aside');
  // The game ran the quest and went back to the queue.
  state.open = false;
  Object.assign(p, {route: OWN, queue: [QUEUED]});
  t.advance();
  assert.equal(t.goal, null);
  assert.notEqual(t.issued.intent.t, 'startQueued');
});

test('assist mode hands a set-aside queue back when the quest waits', () => {
  const {t, p, state} = setup('assist', {route: OWN, queue: [QUEUED]});
  t.advance();
  Object.assign(p, {route: null, held: true, queue: [{kind: 'job', ...OWN}, QUEUED]});
  state.open = false;
  t.advance();
  assert.deepEqual(t.issued.intent, {t: 'startQueued', index: 0});
});

test('assist mode leaves a queue the player paused, or one with no room, alone', () => {
  const paused = setup('assist', {route: null, held: true, queue: [QUEUED]});
  paused.t.advance();
  assert.equal(paused.t.goal, null);
  const full = setup('assist', {route: OWN, queue: [QUEUED, QUEUED, QUEUED]});
  full.t.advance();
  assert.equal(full.t.goal, null);
});

test('potions follow the work under way, whatever is queued behind it', () => {
  const planner = makePlanner();
  const p = player(planner, {route: OWN, queue: [QUEUED], queueSlots: 2, held: false, brews: {}});
  planner.consumable(p, null, 'melee', null);
  assert.notEqual(planner.consumableReason()?.key, 'queue', JSON.stringify(planner.consumableReason()));
  planner.consumable({...p, route: null, held: true}, null, 'melee', null);
  assert.equal(planner.consumableReason()?.key, 'queue', 'a paused queue with nothing running waits');
});
