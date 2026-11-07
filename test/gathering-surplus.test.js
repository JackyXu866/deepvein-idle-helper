import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';
import {packCapacity} from '../src/planner/items.js';
import {validateIntent} from '../src/runtime/intents.js';

// Chopping Trees for gold (the funding goal's placeholder target is past the
// level cap) at the tree site, far from the bank (28-slot pack, about 2 s of
// walking per slot). `prices` are sale values by quality: 0 common .. 4 legendary.
function setup(pack, prices = {}) {
  const planner = makePlanner(), d = planner.data;
  const site = d.sites.find(s => s.jobIds.includes(30)), q = r => 10 + r * d.rarityScale;
  const value = {0: 5, 1: 500, 2: 6000, 3: 160000, 4: 3.7e6, ...prices};
  planner.saleValue = (p, id) => id % d.rarityScale === 10 ? value[Math.floor(id / d.rarityScale)] : 2;
  const p = player(planner, {levels: {woodcutting: 81}, x: site.x, y: site.y, activity: 'working',
    bank: {[q(0)]: 6000, [q(1)]: 600, [q(2)]: 60},
    route: {jobId: 30, siteId: site.id, phase: 'working', onFull: 'bank', limit: null},
    pack: Object.entries(pack).flatMap(([r, n]) => Array.from({length: n}, () => ({itemId: q(+r), qty: 1})))});
  const goal = {skill: 'woodcutting', recipeId: 30, target: planner.thresholds.length, funding: {gold: 4e7}};
  return {planner, d, p, goal, q, capacity: packCapacity(p), drop: () => planner.gatheringSurplus(p, goal, 'melee', 'balanced')};
}

test('cheap common output is dropped in batches of half a pack', () => {
  const {capacity} = setup({});
  assert.equal(capacity, 28);
  assert.equal(setup({0: 13}).drop(), null, 'under half a pack: not yet');
  const result = setup({0: 14, 3: 1}).drop();
  assert.deepEqual(result?.intent, {t: 'dropItem', itemId: 10, qty: 14}, JSON.stringify(result));
  assert.equal(setup({0: 14}, {0: 100000}).drop(), null, 'worth more than its room: kept');
});

test('a pack about to fill drops a few instead of carrying them home', () => {
  assert.equal(setup({0: 6, 3: 10}).drop(), null, 'room left: wait for a batch');
  assert.deepEqual(setup({0: 6, 3: 18}).drop()?.intent, {t: 'dropItem', itemId: 10, qty: 6}, 'four slots left');
  assert.equal(setup({0: 4, 3: 20}).drop(), null, 'too few to be worth a command');
});

test('below epic, any quality goes when its room is worth more; epic and legendary never', () => {
  const uncommon = setup({1: 14}, {1: 5});
  assert.equal(uncommon.drop()?.intent.itemId, uncommon.q(1));
  const rare = setup({2: 14}, {2: 1});
  assert.equal(rare.drop()?.intent.itemId, rare.q(2));
  assert.equal(setup({1: 14}).drop(), null, 'uncommon at 500 is worth its room here');
  assert.equal(setup({3: 14}, {3: 1}).drop(), null, 'epic: always kept');
  assert.equal(setup({4: 14}, {4: 1}).drop(), null, 'legendary: always kept');
  // Judged by price, not rarity: a cheap uncommon goes while a dear common stays.
  const cheapUncommon = setup({0: 14, 1: 14}, {0: 100000, 1: 6});
  assert.equal(cheapUncommon.drop()?.intent.itemId, cheapUncommon.q(1));
  assert.equal(setup({0: 14}, {0: 100000, 1: 6}).drop(), null);
});

test('the page accepts the drop the plan chose and refuses another quality', () => {
  const {planner, p, goal, q, d} = setup({0: 14, 3: 1});
  const plan = planner.gatheringSurplus(p, goal, 'melee', 'balanced');
  const ctx = {planner, goal, style: 'melee', mode: 'balanced'};
  assert.equal(validateIntent(d, p, plan.intent, ctx), true);
  assert.equal(validateIntent(d, p, {t: 'dropItem', itemId: q(3), qty: 1}, ctx), false);
  assert.equal(validateIntent(d, p, {...plan.intent, qty: plan.intent.qty + 1}, ctx), false);
});
