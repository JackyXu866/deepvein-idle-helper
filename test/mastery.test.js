import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rankCost, spentPoints, totalCost} from '../src/engine/mastery-rules.js';
import {allocate} from '../src/planner/mastery-plan.js';
import {validateIntent} from '../src/runtime/intents.js';
import {acknowledged} from '../src/runtime/trainer.js';
import {data, makePlanner, player} from './helpers.js';

const d = data();

test('mastery costs follow 38 + 2n per rank', () => {
  assert.equal(rankCost(1), 40);
  assert.equal(totalCost(1), 40);
  assert.equal(totalCost(3), 40 + 42 + 44);
  let sum = 0;
  for (let n = 1; n <= 250; n++) sum += rankCost(n);
  assert.equal(totalCost(250), sum);
});

test('masteryConfirm validation mirrors the server rules', () => {
  const p = {masteries: {xp: 3}};
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {xp: 4}}), true);
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {xp: 3, gather: 2}}), true);
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {gather: 2}}), false, 'existing track must stay listed');
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {xp: 2}}), false, 'cannot go below locked rank');
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {xp: 3}}), false, 'nothing new');
  assert.equal(validateIntent(d, p, {t: 'masteryConfirm', ranks: {xp: 4, bogus: 1}}), false);
});

test('masteryConfirm is confirmed when the snapshot shows the new ranks', () => {
  const intent = {t: 'masteryConfirm', ranks: {xp: 4, gather: 2}};
  assert.equal(acknowledged({masteries: {xp: 3}}, {masteries: {xp: 4, gather: 2}}, intent), true);
  assert.equal(acknowledged({masteries: {xp: 3}}, {masteries: {xp: 3}}, intent), false);
});

// The account in the screenshot: XP +23% (46), gather +12.5% (25), craft +4% (8), move +1% (2).
const masteries = {xp: 46, gather: 25, craft: 8, move: 2};
function screenshot(free, usage, goal = {skill: 'crafting'}) {
  const planner = makePlanner(), p = player(planner, {levels: {mining: 40, smithing: 40}, masteries});
  return planner.masteryPlan(p, goal, {earned: spentPoints(masteries) + free, usage});
}
const job = skill => d.jobs.find(j => j.skill === skill && !j.grow && j.levelReq <= 1).id;

test('crafting is a small share of the time: craft speed loses to gathering, walking and XP', () => {
  const usage = {[`job:${job('mining')}`]: {seconds: 3000, travelSeconds: 1000}, [`job:${job('smithing')}`]: {seconds: 400, travelSeconds: 50}};
  const plan = screenshot(98, usage);
  assert.equal(plan.intent.t, 'masteryConfirm');
  assert.equal(plan.intent.ranks.craft, 8, 'craft speed untouched');
  assert.ok(plan.intent.ranks.move > 2 || plan.intent.ranks.gather > 25 || plan.intent.ranks.xp > 46, JSON.stringify(plan.intent.ranks));
  assert.match(plan.reason, /按练级/);
});

test('points are saved for the best track instead of a cheaper weaker one', () => {
  const usage = {[`job:${job('mining')}`]: {seconds: 3600, travelSeconds: 0}};
  const plan = screenshot(60, usage);
  assert.equal(plan.intent, null, 'craft (56) is affordable but not worth it');
  assert.equal(plan.saving.id, 'gather');
  assert.equal(plan.saving.need, 90);
  const later = screenshot(98, usage);
  assert.deepEqual(later.intent.ranks, {xp: 46, gather: 26, craft: 8, move: 2}, 'bought once enough is saved');
});

test('the allocation buys the ranks with the most gained per point, max hit by its round-ups', () => {
  // A value that pays only every fifth max-hit rank: one rank alone gains nothing.
  const value = r => Math.floor(r.maxhit / 5) * 10 + r.xp * .1;
  const result = allocate({maxhit: 0, xp: 0}, totalCost(5), ['maxhit', 'xp'], value);
  assert.deepEqual(result.ranks, {maxhit: 5, xp: 0});
  assert.equal(result.left, 0);
});

// A reset returns every point for 50,000 gold, doubling with each reset. Once a
// lasting goal (a main trade) would earn, over a week, at least 1.2x that price
// more with every point placed afresh, the player is told; the helper never resets.
test('a reset worth doing for a lasting main trade is advised, never done', async () => {
  const {resetCost} = await import('../src/planner/mastery-plan.js');
  assert.equal(resetCost(0), 50000);
  assert.equal(resetCost(3), 400000);
  const leveling = {xp: 62, gather: 37, craft: 30, move: 19};
  const plan = (coins, {id = 1, resetSlice = Infinity} = {}) => {
    const planner = makePlanner(), dd = planner.data;
    planner.coinRate = () => 1000;
    const ore = dd.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.levelReq <= 60 && j.output.itemId !== dd.coinId);
    planner.marketUnitValue = (_p, id) => planner.base(id) === ore.output.itemId ? 1000 * (1 + Math.floor((id % 10000) / 1000)) ** 3 : null;
    const p = player(planner, {id, levels: {mining: 90}, coins, masteries: leveling, masteryResets: 0});
    // A lasting income goal: mining that ore as the main trade.
    const goal = {skill: 'mining', recipeId: ore.id, specialization: true, mainSkill: 'mining', rate: {coins: 1000}};
    return planner.masteryPlan(p, goal, {earned: spentPoints(leveling), usage: null, resetSlice});
  };
  const advised = plan(1e7);
  // The worker builds a new planner every run: the check goes on across them,
  // a short slice each, instead of pricing every point in one run (that took
  // seconds in 补精通 and ran past the 8-second limit).
  let sliced = null, runs = 0;
  while (!sliced?.resetAdvice && runs < 500) { sliced = plan(1e7, {id: 2, resetSlice: 0}); runs++; }
  assert.ok(runs > 1 && sliced?.resetAdvice, `advised after ${runs} runs`);
  assert.deepEqual(sliced.resetAdvice.ranks, advised.resetAdvice.ranks, 'the sliced check reaches the same allocation');
  assert.notEqual(advised?.intent?.t, 'masteryReset', 'never sent');
  assert.match(advised?.resetAdvice?.reason ?? '', /建议重置精通.*从头分配/, JSON.stringify(advised));
  assert.equal(advised.resetAdvice.cost, 50000);
  assert.equal(validateIntent(d, {masteries: leveling, coins: 1e6, masteryResets: 0}, {t: 'masteryReset', pay: 'coins'}), true);
  assert.equal(validateIntent(d, {masteries: leveling, coins: 1e6, masteryPage: 2}, {t: 'masteryReset', pay: 'coins'}), false, 'never on the enhance page');
  assert.equal(acknowledged({masteries: leveling, masteryResets: 0}, {masteries: {}, masteryResets: 1}, {t: 'masteryReset', pay: 'coins'}), true);
});
