import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';
import {masteryCandidates} from '../src/planner/collection.js';

const IRON = 3, IRON_BAR = 41, COPPER = 1, ROUGH_GEM = 100;
const idOf = (d, n) => Object.values(d.items).find(i => i.name === n).id;

function setup(collections, extra = {}) {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  planner.coinRate = () => 10; // time is priced at the gold rate
  const p = player(planner, {hp: 100, activity: 'idle', path: null, collections, ...extra});
  return {planner, d, p, R: d.rarityScale};
}

test('candidates: every started collection\'s next tier with its points (quality multiplies them)', () => {
  const {d, p, R} = setup({});
  p.collections = {[IRON]: 9, [COPPER]: 50, [IRON_BAR + R]: 4, [IRON_BAR]: 2};
  const list = masteryCandidates(d, p);
  assert.deepEqual(list.map(c => c.itemId).sort((a, b) => a - b), [COPPER, IRON, IRON_BAR, IRON_BAR + R].sort((a, b) => a - b));
  const of = id => list.find(c => c.itemId === id);
  assert.equal(of(IRON).target, 10);
  assert.equal(of(IRON).points, 1);
  assert.equal(of(COPPER).points, 3, '100 pays 3');
  assert.equal(of(IRON_BAR + R).points, 3, 'uncommon x3');
});

test('legendary qualities and planted crops are skipped; seeds are not', () => {
  const {d, p, R} = setup({});
  const crop = d.jobs.find(j => j.grow).output.itemId, seed = idOf(d, 'Potato seed');
  p.collections = {[IRON + 4 * R]: 5, [crop]: 5, [seed]: 5};
  assert.deepEqual(masteryCandidates(d, p).map(c => c.itemId), [seed]);
});

test('the cheapest gold per point goes first (time at the gold rate); the next follows when a tier is reached', () => {
  const {planner, p} = setup({[IRON]: 9, [COPPER]: 50});
  Object.assign(p, player(planner, {levels: {mining: 20}, hp: 100, activity: 'idle', path: null, collections: p.collections}));
  const first = planner.masteryChooseGoal(p, 'melee');
  // One iron for 1 point against 50 copper for 3.
  assert.equal(first.mastery.itemId, IRON);
  assert.match(first.reason, /金币\/点/);
  p.collections[IRON] = 10;
  assert.ok(planner.masteryCompleted(p, first));
  assert.equal(planner.masteryChooseGoal(p, 'melee').mastery.itemId, COPPER);
  assert.match(planner.masteryStatus(p), /Copper/);
});

test('forge levels: points the first time a tier and quality reaches each +N, priced with their time', async () => {
  const {forgePoints, forgeReached} = await import('../src/planner/collection.js');
  const {d} = setup({});
  assert.equal(forgePoints(d, 0, 0, 1), 5, 'the floor');
  assert.equal(forgePoints(d, 5, 3, 15), 1334, 'tier 6 epic +15');
  assert.equal(forgePoints(d, 5, 4, 15), 3334, 'tier 6 legendary +15');
  assert.equal(forgePoints(d, 0, 0, 16), 0, 'nothing past +15');
  assert.equal(forgeReached({forgeLog: {0: 0b11111}}, 0, 0, 5), true);
  assert.equal(forgeReached({forgeLog: {0: 0b11111}}, 0, 0, 6), false);
});

test('a held piece is forged beside the collection work when that costs less per point', () => {
  const {planner, d, p} = setup({[COPPER]: 50}, {coins: 1_000_000});
  const knife = d.gear.find(g => g.slot === 'knife').itemId; // a cheap low-tier piece
  p.bank = {...p.bank, [knife]: 1, [d.shardId]: 500};
  p.forgeLog = {};
  planner.stockSold = () => false; // everyday selling off: held shards cost nothing to use
  const goal = planner.masteryChooseGoal(p, 'melee');
  assert.equal(goal.mastery.itemId, COPPER, 'the work is a collection');
  const forge = planner.masteryForge(p, 'melee', goal);
  assert.deepEqual(forge?.intent, {t: 'enhance', itemId: knife, toPlus: 1, once: true});
  assert.match(forge.reason, /金币\/点/);
  // Without the server's forge record nothing is forged (no guessing).
  assert.equal(planner.masteryForge({...p, forgeLog: undefined}, 'melee', goal), null);
  // An enhancement under way waits.
  assert.equal(planner.masteryForge({...p, enhance: {itemId: knife}}, 'melee', goal), null);
});

test('an uncommon bar waits on gathering for uncommon ore instead of using common ore', () => {
  const {planner, d, p, R} = setup({});
  Object.assign(p, player(planner, {levels: {mining: 20, smithing: 20}, hp: 100, activity: 'idle', path: null,
    bank: {[IRON]: 500, [IRON + R]: 1}, collections: {[IRON_BAR + R]: 4}}));
  const goal = planner.masteryChooseGoal(p, 'melee');
  assert.equal(goal.mastery.itemId, IRON_BAR + R);
  const plan = planner.plan(p, goal, 'melee');
  const job = d.jobs.find(j => j.id === plan.intent?.jobId);
  assert.equal(job?.output.itemId, IRON, JSON.stringify(plan.intent ?? plan.reason));
  assert.match(plan.reason, /等待同品质产出/);
  // With the uncommon ore in stock, the uncommon recipe runs for the remaining six.
  p.bank[IRON + R] = 6;
  const craft = planner.plan(p, planner.masteryChooseGoal(p, 'melee'), 'melee');
  assert.equal(d.jobs.find(j => j.id === craft.intent?.jobId)?.output.itemId, IRON_BAR, JSON.stringify(craft.intent ?? craft.reason));
  assert.equal(craft.intent.rarity, 1);
  assert.equal(craft.intent.limit, 6);
});

test('rough gems compare every unlocked source: the gem stall beats iron once thieving opens it', () => {
  const mine = setup({}), stall = setup({});
  for (const [s, thieving] of [[mine, 1], [stall, 60]])
    Object.assign(s.p, player(s.planner, {levels: {mining: 20, thieving}, hp: 100, activity: 'idle', path: null,
      collections: {[ROUGH_GEM]: 7}}));
  const pick = s => s.d.jobs.find(j => j.id === s.planner.plan(s.p, s.planner.masteryChooseGoal(s.p, 'melee'), 'melee').intent?.jobId);
  assert.equal(pick(mine)?.name, 'Iron');
  assert.equal(pick(stall)?.name, 'Gem stall');
});
