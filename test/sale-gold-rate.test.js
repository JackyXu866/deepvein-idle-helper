import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// The gold rate counts jobs that earn by selling what they make: smelting
// Cobalt bars that buyers take at 726 earns far more per second than thieving.
test('the gold rate counts a processed product that sells', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {smithing: 79, mining: 88, thieving: 66}});
  const direct = planner.goldJobs(p)[0].rate;
  planner.marketUnitValue = (_p, id) => id === 43 ? 726 : null;
  assert.ok(planner.coinRate(p) > direct * 2, `${planner.coinRate(p)} vs ${direct}`);
  assert.equal(d.jobs.find(j => j.id === planner.saleJobs(p)[0].jobId).name, 'Cobalt bar');
});

test('raw materials and quality output do not count as sale income', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {mining: 88, thieving: 66}});
  planner.marketUnitValue = (_p, id) => id === 7 || id === 1043 ? 1e6 : null;
  const jobs = planner.saleJobs(p).map(r => d.jobs.find(j => j.id === r.jobId));
  assert.ok(jobs.every(j => j.inputs.length), 'only made products');
});
