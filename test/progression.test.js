import test from 'node:test';
import assert from 'node:assert/strict';
import {BAND, laggingSuppliers} from '../src/planner/progression.js';
import {makePlanner, player} from './helpers.js';

const develop = (planner, levels) => {
  planner.watchMarket = () => {};
  planner.resetDevelopment?.();
  const p = player(planner, {levels, coins: 1000, hp: 300, activity: 'idle', path: null, held: false});
  return {p, goal: planner.growthChooseGoal(p, {}, {}, 'melee')};
};

test('自主发展 never trains a skill more than the band above the lowest', () => {
  const planner = makePlanner(), d = planner.data;
  const levels = Object.fromEntries(d.skills.map(s => [s, 30]));
  Object.assign(levels, {crafting: 71, mining: 30, fishing: 32});
  const {p, goal} = develop(planner, levels);
  const lv = planner.levels(p);
  const trained = planner.trainedSkills('melee').filter(s => !['enhancing', 'defence', 'hitpoints'].includes(s) && s !== 'farming');
  const lowest = Math.min(...trained.map(s => lv[s]));
  assert.ok(goal, 'a project is chosen');
  assert.notEqual(goal.skill, 'crafting', 'the skill far ahead waits for the others');
  assert.ok(goal.target <= lowest + BAND || /原料技能/.test(goal.reason), goal.reason);
  assert.match(goal.reason, new RegExp(`最低 ${lowest} 级以上 ${BAND} 级以内`));
});

test('suppliers first: smithing\'s next bar needs ore the miner cannot mine yet', () => {
  const planner = makePlanner(), d = planner.data;
  const lv = Object.fromEntries(d.skills.map(s => [s, 40]));
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.inputs.some(i => d.jobs.some(o => o.output.itemId === i.itemId && o.skill === 'mining' && o.levelReq > 40)));
  const ore = bar.inputs.map(i => d.jobs.find(o => o.output.itemId === i.itemId && o.skill === 'mining')).find(o => o && o.levelReq > 40);
  const lagging = laggingSuppliers(d, {...lv, smithing: bar.levelReq - 1}, 'smithing', bar.levelReq - 1, bar.levelReq);
  assert.ok(lagging.some(s => s.skill === 'mining' && s.level >= ore.levelReq), JSON.stringify(lagging));
  // Once mining is there, nothing lags.
  assert.deepEqual(laggingSuppliers(d, {...lv, smithing: bar.levelReq - 1, mining: 99}, 'smithing', bar.levelReq - 1, bar.levelReq)
    .filter(s => s.skill === 'mining'), []);
});
