import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// A daily must not wait on a gear project: an epic Cobalt rod whose epic
// materials are missing used to hold the Lobster daily until it was set aside.
test('a quest goal skips a gear project it cannot finish and does the quest', () => {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const lobster = d.jobs.find(j => j.id === 26), bank = d.banks[0];
  const rod = d.gear.find(g => g.slot === 'rod' && d.items[g.itemId].name === 'Cobalt rod').itemId;
  const p = player(planner, {levels: {fishing: 71, smithing: 77, fletching: 71, mining: 88}, x: bank.x, y: bank.y,
    coins: 0, hp: 100, activity: 'idle', path: null, held: false, route: null,
    quests: {day: 0, week: 0, weekly: [], daily: [{id: 'd1:gather:26', kind: 'gather', jobId: lobster.id, goal: 30, done: 0, claimed: false,
      reward: {coins: 1, xp: 1, skill: 'fishing'}}]}});
  const quest = {key: 'daily:0:d1:gather:26', id: 'd1:gather:26', period: 'daily', stamp: 0, kind: 'gather', jobId: lobster.id};
  const goal = {skill: 'fishing', recipeId: lobster.id, recipes: {fishing: lobster.id}, batch: 30, target: 72, growth: true,
    quest, mandatory: true, budget: {coins: 0, items: {}},
    upgrade: {id: rod + 3 * d.rarityScale, slot: 'rod', skill: 'fishing', priority: true}};
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(plan?.intent?.jobId, lobster.id, JSON.stringify([plan?.label, plan?.reason]));
  assert.doesNotMatch(plan.reason ?? '', /装备升级|阶段装备/);
});
