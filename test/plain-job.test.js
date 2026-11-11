import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaWork} from '../src/planner/rates.js';
import {makePlanner, player} from './helpers.js';

// Client `plain` jobs (Pure coal, job 344): always common, luck never makes the
// output rarer. 2026-11-11: priced as ordinary coal, it showed the very same
// rates as Coal in the plan tab.
test('a plain job yields common output only; its ordinary twin rolls qualities', () => {
  const planner = makePlanner(), d = planner.data;
  const pure = d.jobs.find(j => j.id === 344), coal = d.jobs.find(j => j.id === 5);
  assert.equal(pure.plain, true);
  const p = player(planner, {levels: {mining: 80}, masteries: {rare: 50}});
  const lv = planner.levels(p);
  const a = formulaWork(d, planner, p, pure, lv), b = formulaWork(d, planner, p, coal, lv);
  assert.deepEqual(a.tierOutput.slice(1), [0, 0, 0, 0], 'no quality output');
  assert.equal(a.commonOutput, a.success * pure.output.qty, 'every coal is common');
  assert.ok(b.tierOutput.slice(1).some(n => n > 0) && b.commonOutput < a.commonOutput, 'ordinary coal rolls some away from common');
});
