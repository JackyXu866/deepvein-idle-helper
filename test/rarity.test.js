import test from 'node:test';
import assert from 'node:assert/strict';
import {rarityFactor, shrineBonus} from '../src/planner/rarity.js';
import {combatDrops, workEstimate} from '../src/planner/estimates.js';
import {qualityGain, workInputs} from '../src/planner/rates.js';
import {chooseMastery} from '../src/engine/mastery.js';
import {makePlanner, player} from './helpers.js';

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

test('rare-find mastery is bought when its gold beats the XP rank', () => {
  const planner = makePlanner(), p = player(planner, {levels: {mining: 50}});
  const api = {masteryEarnedPoints: () => 40, masteryTracks: [{id: 'xp'}, {id: 'rare'}]};
  const goal = {skill: 'mining'};
  assert.match(chooseMastery(api, p, goal, {data: planner.data, rareGain: .05}).label, /寻宝 \+1/);
  assert.match(chooseMastery(api, p, goal, {data: planner.data, rareGain: 0}).label, /经验获取 \+1/);
});
