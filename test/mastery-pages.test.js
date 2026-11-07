import test from 'node:test';
import assert from 'node:assert/strict';
import {enhanceOdds, enhanceRanks, pageStep} from '../src/planner/mastery-pages.js';
import {enhanceQuote} from '../src/planner/inventory.js';
import {validateIntent} from '../src/runtime/intents.js';
import {spentPoints} from '../src/engine/mastery-rules.js';
import {makePlanner, player} from './helpers.js';

// Page 1 is for work, page 2 for enhancing only: enhancing is priced with page
// 2's odds (every point there) and runs only while page 2 is active.
const work = {xp: 50, gather: 37, craft: 24, move: 15, maxhit: 1}; // 9,624 points
const withPages = (extra = {}) => ({masteries: work, masteryPage: 1, masteryOther: {}, lastTick: 100000, ...extra});

test('enhancing is priced with every point on page 2 (80 ranks: odds x1.2)', () => {
  assert.equal(spentPoints(work), 9624);
  assert.equal(enhanceRanks(withPages()), 80);
  assert.equal(enhanceOdds(80), 1.2);
  assert.equal(enhanceRanks({masteries: {enhance: 12}}), 12, 'one page: its own ranks');
  assert.equal(enhanceOdds(400), 1.5, 'capped at x1.5');
  const planner = makePlanner(), d = planner.data;
  const blade = d.gear.find(g => g.slot === 'weapon').itemId + 10 * d.plusScale;
  const one = enhanceQuote(d, planner, player(planner, {masteries: work}), blade).chance;
  const two = enhanceQuote(d, planner, player(planner, withPages()), blade).chance;
  assert.ok(Math.abs(two / one - 1.2) < 1e-9, `${one} -> ${two}`);
});

test('the helper switches to page 2 to enhance and back to page 1 after, with no cooldown (1.0.1213)', () => {
  assert.deepEqual(pageStep(withPages(), true).intent, {t: 'masteryPage', page: 2});
  assert.equal(pageStep(withPages(), false), null, 'on the work page already');
  assert.deepEqual(pageStep(withPages({masteryPage: 2}), false).intent, {t: 'masteryPage', page: 1});
  assert.deepEqual(pageStep(withPages({masterySwitchTick: 99990}), true).intent, {t: 'masteryPage', page: 2}, 'just switched: switches again');
  assert.equal(pageStep({masteries: work, masteryPage: 1, masteryOther: null}, true), null, 'no second page');
});

test('page 2 buys enhance ranks only; page 1 never buys enhance', () => {
  const planner = makePlanner(), tracks = ['xp', 'gather', 'craft', 'move', 'hp', 'maxhit', 'accuracy', 'rare', 'enhance'];
  const p = player(planner, {masteries: {}, masteryPage: 2, masteryOther: work});
  const choice = planner.masteryPlan(p, null, {earned: 9624, tracks});
  assert.deepEqual(choice.intent, {t: 'masteryConfirm', ranks: {enhance: 80}});
  const full = planner.masteryPlan({...p, masteries: {enhance: 80}}, null, {earned: 9624, tracks});
  assert.equal(full, null, 'nothing left to buy');
  const mining = planner.data.jobs.find(j => j.skill === 'mining' && j.levelReq <= 1);
  const page1 = planner.masteryPlan(player(planner, {masteries: work, masteryPage: 1, masteryOther: {enhance: 80}}),
    {skill: 'mining', recipeId: mining.id}, {earned: 20000, tracks});
  assert.equal(page1.intent.t, 'masteryConfirm');
  assert.equal(page1.intent.ranks.enhance, undefined);
});

test('a page switch is valid only to the other owned page', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, withPages());
  assert.equal(validateIntent(d, p, {t: 'masteryPage', page: 2}, {planner}), true);
  assert.equal(validateIntent(d, p, {t: 'masteryPage', page: 1}, {planner}), false, 'already there');
  assert.equal(validateIntent(d, {...p, masterySwitchTick: p.lastTick - 10}, {t: 'masteryPage', page: 2}, {planner}), true, 'no cooldown');
  assert.equal(validateIntent(d, {...p, masteryOther: null}, {t: 'masteryPage', page: 2}, {planner}), false, 'not owned');
});
