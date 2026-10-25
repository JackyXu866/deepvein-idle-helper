import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInventory} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// A late-game account with a large bank: some of every item, and every
// quality of the ores and bars. The sale review once compared every item
// with every other, and the income table ran it ten times per candidate, so
// a plan took several seconds and the helper paused ("本次规划耗时过长").
function rich() {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  const levels = Object.fromEntries(d.skills.map(s => [s, 72]));
  Object.assign(levels, {herblore: 60, smithing: 77, mining: 80, melee: 75, defence: 70, hitpoints: 75});
  const bank = {};
  for (const id of Object.keys(d.items).map(Number).slice(0, 400)) bank[id] = 500;
  for (const j of d.jobs.filter(j => j.skill === 'mining' || j.skill === 'smithing')) for (let r = 0; r < 4; r++) bank[j.output.itemId + r * R] = 300;
  const find = (slot, name) => d.gear.find(g => g.slot === slot && d.items[g.itemId].name.startsWith(name))?.itemId;
  const meteoric = d.jobs.find(j => j.skill === 'mining' && /Meteoric/.test(j.name));
  const site = d.sites.find(s => s.jobIds.includes(meteoric.id));
  const p = player(planner, {levels, coins: 5e6, hp: 750, bank, lastTick: 500000, activity: 'working', path: null,
    equipment: {weapon: find('weapon', 'Meteoric'), helmet: find('helmet', 'Meteoric'), pickaxe: find('pickaxe', 'Meteoric')},
    route: {jobId: meteoric.id, siteId: site.id, phase: 'working', limit: null, onFull: 'bank'}});
  return {planner, d, p};
}

test('reviewing one item gives the verdict the full review gives', () => {
  const {planner, d, p} = rich();
  const full = reviewInventory(d, planner, p, null, 'melee');
  for (const row of full.items.filter((_, i) => i % 7 === 0)) {
    const [one] = reviewInventory(d, planner, p, null, 'melee', undefined, {only: [row.itemId]}).items;
    assert.deepEqual([one.keep, one.sell, one.reason], [row.keep, row.sell, row.reason], row.name);
  }
});

test('a late-game plan with a large bank stays well under the 3-second limit', () => {
  const {planner, p} = rich();
  const start = performance.now();
  planner.incomeRows(p, 'melee');
  planner.gearTargets(p, 'melee');
  planner.plan(p, {skill: 'herblore', target: 70, development: true, growth: true, budget: {coins: 0, items: {}}}, 'melee');
  const ms = performance.now() - start;
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
});
