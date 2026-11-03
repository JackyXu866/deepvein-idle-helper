import test from 'node:test';
import assert from 'node:assert/strict';
import {enhanceOdds, enhanceRanks, pageStep} from '../src/planner/mastery-pages.js';
import {enhanceQuote} from '../src/planner/inventory.js';
import {chooseMastery} from '../src/engine/mastery.js';
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

test('the helper switches to page 2 to enhance and back to page 1 after; the cooldown holds enhancing', () => {
  assert.deepEqual(pageStep(withPages(), true, 600).intent, {t: 'masteryPage', page: 2});
  assert.equal(pageStep(withPages(), false, 600), null, 'on the work page already');
  assert.deepEqual(pageStep(withPages({masteryPage: 2}), false, 600).intent, {t: 'masteryPage', page: 1});
  const cooling = pageStep(withPages({masterySwitchTick: 99800}), true, 600);
  assert.equal(cooling.intent, null);
  assert.equal(cooling.waiting, true);
  assert.match(cooling.reason, /冷却约 180 秒/);
  assert.equal(pageStep({masteries: work, masteryPage: 1, masteryOther: null}, true, 600), null, 'no second page');
});

test('page 2 buys enhance ranks only; page 1 never buys enhance', () => {
  const api = {masteryEarnedPoints: () => 9624, masteryTracks: ['xp', 'gather', 'craft', 'move', 'hp', 'maxhit', 'accuracy', 'rare', 'enhance'].map(id => ({id}))};
  const p = {skills: {mining: 1}, masteries: {}, masteryPage: 2, masteryOther: work};
  const choice = chooseMastery(api, p, null);
  assert.deepEqual(choice.intent, {t: 'masteryConfirm', ranks: {enhance: 80}});
  const full = chooseMastery(api, {...p, masteries: {enhance: 80}}, null);
  assert.equal(full, null, 'nothing left to buy');
  const page1 = chooseMastery({...api, masteryEarnedPoints: () => 20000}, {skills: {mining: 1}, masteries: work, masteryPage: 1, masteryOther: {enhance: 80}}, {skill: 'mining'});
  assert.equal(page1?.intent?.ranks?.enhance, undefined);
});

test('a page switch is valid only to the other owned page, outside the cooldown', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, withPages());
  assert.equal(validateIntent(d, p, {t: 'masteryPage', page: 2}, {planner}), true);
  assert.equal(validateIntent(d, p, {t: 'masteryPage', page: 1}, {planner}), false, 'already there');
  assert.equal(validateIntent(d, {...p, masterySwitchTick: p.lastTick - 10}, {t: 'masteryPage', page: 2}, {planner}), false, 'cooldown');
  assert.equal(validateIntent(d, {...p, masteryOther: null}, {t: 'masteryPage', page: 2}, {planner}), false, 'not owned');
});
