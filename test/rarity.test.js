import test from 'node:test';
import assert from 'node:assert/strict';
import {rarityFactor, shrineBonus} from '../src/planner/rarity.js';
import {combatDrops, workEstimate} from '../src/planner/estimates.js';
import {qualityGain, workInputs} from '../src/planner/rates.js';
import {createMasteryPlan} from '../src/planner/mastery-plan.js';
import {makePlanner, onlyCollections, player} from './helpers.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const AMULET = -1;
// A planner whose amulet has luck 1 (the rest of the gear from the data).
const lucky = () => {
  const planner = makePlanner(), stats = planner.equipmentStats;
  planner.equipmentStats = id => id === AMULET ? {luck: 1} : stats(id);
  return planner;
};
const boosted = planner => player(planner, {levels: {mining: 99, melee: 99, hitpoints: 99, defence: 99},
  equipment: {amulet: AMULET}, brews: {hunter: 5000, blessing: 5000}, brewTier: {hunter: 0},
  masteries: {rare: 10}, house: {shrine: 4}, houseFurniture: {shrine: {cell: 0, slot: 0}}});

test('the quality factor is (1 + luck) times the summed bonuses, as the client rolls it', () => {
  const planner = lucky(), d = planner.data, p = boosted(planner);
  close(shrineBonus(d, p), 4 * .01 * .5);
  // Hunter .25, blessing .1, 10 rare ranks .05, shrine .02; luck 1 from the amulet.
  const fight = rarityFactor(d, planner, p, 'melee');
  close(fight.luck, 1);
  close(fight.factor, 2 * 1.42);
  close(fight.dropFactor, 2 * 1.40, 1e-9);
  // Farming has no shrine; nothing active leaves luck alone.
  close(rarityFactor(d, planner, p, 'farming').factor, 2 * 1.40);
  close(rarityFactor(d, planner, {...p, brews: {}, masteries: {}, houseFurniture: {}}, 'melee').factor, 2);
  // The tool's quality adds to luck when gathering.
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length);
  const inputs = workInputs(d, planner, p, job);
  close(inputs.rarityFactor, (1 + inputs.luck) * 1.42);
});

test('drops and gathered output use the whole factor; a monster bonus drop leaves the shrine out', () => {
  const planner = lucky(), d = planner.data, monster = d.monsters.find(m => m.bonus && m.drop != null);
  const drops = combatDrops(d, monster, {factor: 3, dropFactor: 2});
  close(drops[monster.drop + d.rarityScale] / (monster.dropChance ?? 1), 3 * (d.rarityChance.uncommon - d.rarityChance.rare));
  close(drops[monster.bonus.itemId], Math.min(1, monster.bonus.chance * 2));
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.output.itemId !== d.coinId);
  const e = workEstimate(d, job, 99, {rarityFactor: 3});
  close(e.tierOutput[4] / e.output, 3 * d.rarityChance.legendary);
});

test('a brew or rank is worth the rarer drops it adds, at sale value', () => {
  const planner = lucky(), d = planner.data, p = boosted(planner), R = d.rarityScale;
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.output.itemId !== d.coinId && j.levelReq <= 99);
  const ore = job.output.itemId, prices = {[ore]: 10, [ore + R]: 100, [ore + 2 * R]: 1000, [ore + 3 * R]: 1e4, [ore + 4 * R]: 1e6};
  planner.saleValue = (_p, id) => prices[id] ?? 0;
  const gain = qualityGain(d, planner, p, {job}, .25);
  const at = x => workEstimate(d, job, 99, workInputs(d, planner, p, job, p.equipment, x));
  const worth = e => e.tierOutput.reduce((n, q, i) => n + q * prices[ore + i * R], 0);
  close(gain, (worth(at(.25)) - worth(at(0))) / at(0).seconds);
  assert.ok(gain > 0);
  // Linear in the bonus: twice the bonus, twice the gold.
  close(qualityGain(d, planner, p, {job}, .5), 2 * gain, 1e-6);
  // Crafting rolls no quality.
  assert.equal(qualityGain(d, planner, p, {job: d.jobs.find(j => j.inputs.length && !j.grow)}, .25), 0);
});

test('补精通 counts a rarer collection that rare-find ranks bring within reach', () => {
  const planner = makePlanner(), p = player(planner, {});
  // Twelve ordinary targets at 100 gold per point; a rare one outside them at 120.
  const targets = [...Array.from({length: 12}, (_, i) => ({itemId: i + 1, points: 10, gold: 1000})),
    {itemId: 99, points: 100, gold: 12000, rare: true}];
  const stub = {...planner, coinRate: () => 1, masteryTargets: () => targets,
    masteryPrice: (q, t) => t.rare ? 12000 / (1 + .05 * (q.masteries.rare ?? 0)) : 1000};
  const goal = createMasteryPlan(planner.data, stub).objective(p, {mastery: targets[0]}, 'melee', null);
  // At 20 ranks the rare target is the cheapest way to the same 120 points: 6,000 + 2,000.
  assert.equal(goal.value({rare: 0}), -12000);
  assert.equal(goal.value({rare: 20}), -8000);
});

test('补精通 spends points only on what finishes its next collections sooner', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.levelReq <= 1 && j.output.itemId !== d.coinId);
  const ore = job.output.itemId;
  // Rare and epic ore collections started: their next tiers are the cheapest points.
  const p = player(planner, {levels: {mining: 30}, collections: onlyCollections(d, {[ore]: 50, [ore + 2 * R]: 3, [ore + 3 * R]: 1})});
  planner.coinRate = () => 50;
  const targets = planner.masteryTargets(p, 'melee');
  assert.ok(targets.some(t => t.itemId === ore + 2 * R), 'the rare ore collection is a target');
  const plan = planner.masteryPlan(p, {mastery: targets[0], skill: 'mining'}, {earned: 3000, style: 'melee'});
  assert.equal(plan.intent.t, 'masteryConfirm');
  const ranks = plan.intent.ranks;
  assert.ok((ranks.gather ?? 0) + (ranks.rare ?? 0) > 0, JSON.stringify(ranks));
  for (const id of ['xp', 'craft', 'maxhit', 'accuracy']) assert.equal(ranks[id], undefined, `${id} does not finish a collection`);
  assert.match(plan.reason, /按补精通/);
  // Gathering walks to the bank with each full pack: move speed makes a target cheaper.
  const t = targets.find(x => x.itemId === ore + 2 * R);
  const price = move => planner.masteryPrice({...p, masteries: {move}}, t, 'melee', {rate: 50});
  assert.ok(price(40) < price(0), `${price(40)} vs ${price(0)}`);
});
