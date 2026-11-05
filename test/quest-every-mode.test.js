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

// Live: the player had their own work and one more job queued; the dailies
// were never started. The game's goQuest sets the work aside at the front of
// the queue, runs the quest, then carries on with the queue.
function assist(planner, extra = {}) {
  const d = planner.data, now = 1e9, day = Math.floor(1e6 / (86400000 / d.tickMs));
  const job = d.jobs.find(j => j.skill === 'woodcutting' && !j.inputs.length && j.levelReq <= 60);
  const cook = d.jobs.find(j => j.skill === 'cooking' && j.inputs.length === 1 && j.levelReq <= 60);
  const p = player(planner, {levels: {woodcutting: 80, cooking: 80, mining: 80}, lastTick: 1e6,
    route: {zoneId: null, siteId: 46, jobId: 45, onFull: 'bank', limit: null, phase: 'toWork'},
    queue: [{kind: 'job', siteId: 23, jobId: 8, onFull: 'bank', limit: null, rarity: 0}], queueSlots: 2, held: false,
    quests: {day, week: Math.floor(day / 7), rerolled: day,
      daily: [{id: 'g', kind: 'gather', jobId: job.id, goal: 30, done: 0, claimed: false, reward: {coins: 1, xp: 1, skill: 'woodcutting'}},
        {id: 'c', kind: 'craft', jobId: cook.id, goal: 15, done: 0, claimed: false, reward: {coins: 1, xp: 1, skill: 'cooking'}}],
      weekly: []}, ...extra});
  const t = new Trainer(d, planner, () => {}, () => now);
  Object.assign(t, {mode: 'assist', style: 'melee', active: true, compatible: true, player: p, autoFallback: false});
  t.issue = next => { t.plan = next; t.issued = next; };
  planner.harvestOnly = () => null;
  return {t, p, job, cook};
}

test('assist mode starts a quest with the game\'s goQuest, beside the player\'s queue', () => {
  const planner = makePlanner();
  planner.trainedSkills = () => planner.data.skills;
  const {t, p} = assist(planner);
  const pick = planner.questGo(p, 'melee', {});
  assert.ok(pick, 'a quest the game can run as it stands');
  t.advance();
  assert.equal(t.issued?.intent?.t, 'goQuest', JSON.stringify([t.issued, t.message]));
  assert.equal(t.drives(), false, 'the player\'s work and queue stay theirs');
});

test('potions follow the work under way, whatever is queued behind it', () => {
  const planner = makePlanner();
  const {p} = assist(planner, {brews: {}});
  planner.consumable(p, null, 'melee', null);
  assert.notEqual(planner.consumableReason()?.key, 'queue', JSON.stringify(planner.consumableReason()));
  planner.consumable({...p, route: null, held: true}, null, 'melee', null);
  assert.equal(planner.consumableReason()?.key, 'queue', 'a paused queue with nothing running waits');
});

test('assist mode leaves a quest whose inputs are missing to the other modes', () => {
  const planner = makePlanner();
  planner.trainedSkills = () => planner.data.skills;
  const {p, cook} = assist(planner);
  p.quests.daily = p.quests.daily.filter(q => q.id === 'c');
  p.bank = {...p.bank, [cook.inputs[0].itemId]: 14};
  assert.equal(planner.questGo(p, 'melee', {}), null, '14 of 15 raw inputs');
  p.bank[cook.inputs[0].itemId] = 15;
  assert.equal(planner.questGo(p, 'melee', {})?.intent.id, 'c');
  // Not while the player has paused their queue, nor while a quest runs.
  assert.equal(planner.questGo({...p, held: true}, 'melee', {}), null);
  assert.equal(planner.questGo({...p, route: {...p.route, questId: 'g'}}, 'melee', {}), null);
});
