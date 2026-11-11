import test from 'node:test';
import assert from 'node:assert/strict';
import {PROTECTION_SCROLL, attemptProtection, enhancementLadder, expectedEnhancement} from '../src/planner/investment.js';
import {enhanceQuote} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Client BO (old rules, enhanceRedesign off): from +2 up, a failed attempt
// with a Protection scroll held takes one scroll and drops one level instead
// of falling to +0. 2026-11-10: without it, an epic amulet +2 to +15 priced at
// about 1.0B; with the scrolls held, about 160M.
function setup(scrolls) {
  const planner = makePlanner(), d = planner.data;
  const prices = {[PROTECTION_SCROLL]: 800000, [d.shardId]: 620};
  planner.saleValue = (_p, id) => prices[id] ?? 0;
  const p = player(planner, {levels: {enhancing: 50}, bank: scrolls ? {[PROTECTION_SCROLL]: scrolls} : {}});
  return {planner, d, p};
}
const amulet = 23186; // epic Meteoric amulet +2

test('a held scroll makes high steps far cheaper, each step protected only when that is cheaper', () => {
  const bare = setup(0), held = setup(64);
  const without = expectedEnhancement(bare.d, bare.planner, bare.p, amulet, 15);
  const with_ = expectedEnhancement(held.d, held.planner, held.p, amulet, 15);
  assert.equal(without.scrolls, 0);
  assert.ok(with_.gold + with_.shards * 620 < (without.gold + without.shards * 620) / 3, `${with_.gold} vs ${without.gold}`);
  assert.ok(with_.scrolls > 0);
  const ladder = enhancementLadder(held.d, held.planner, held.p, amulet, 15);
  assert.ok(!ladder.protect[0] && !ladder.protect[1], 'never below +2 (the game protects from +2)');
  const first = ladder.protect.findIndex(Boolean);
  assert.ok(first >= 2 && ladder.protect.slice(first, 15).every(Boolean), 'once worth it, every step above is protected');
});

test('a protected step costs (g + (1-s)(scroll + the step below)) / s', () => {
  const {planner, d, p} = setup(64);
  const line = amulet % d.plusScale, ladder = enhancementLadder(d, planner, p, line, 15);
  const k = ladder.protect.findIndex(Boolean) + 1; // a protected step whose step below is protected too
  const step = j => ({gold: ladder[j + 1].gold - ladder[j].gold, shards: ladder[j + 1].shards - ladder[j].shards});
  const q = enhanceQuote(d, planner, p, line + k * d.plusScale), s = q.chance;
  const below = step(k - 1), here = step(k);
  // gold includes the scrolls' value: (g + (1-s)(800k + below)) / s
  assert.ok(Math.abs(here.gold - (q.gold + (1 - s) * (800000 + below.gold)) / s) < 1e-3 * here.gold, `${here.gold}`);
  assert.ok(Math.abs(here.shards - (q.shards + (1 - s) * below.shards) / s) < 1e-6 * here.shards);
});

test('the enhance command carries protectFrom on a protected step, and nothing without scrolls', () => {
  const held = setup(64), bare = setup(0);
  const ten = amulet % held.d.plusScale + 10 * held.d.plusScale;
  assert.deepEqual(attemptProtection(held.d, held.planner, held.p, ten), {protectFrom: 10});
  assert.deepEqual(attemptProtection(bare.d, bare.planner, bare.p, ten), {});
  assert.deepEqual(attemptProtection(held.d, held.planner, held.p, amulet % held.d.plusScale), {}, '+0: unprotected');
});
