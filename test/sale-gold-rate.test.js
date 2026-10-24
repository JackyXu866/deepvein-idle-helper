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

test('common ore sold counts, with its bank trips; quality output does not', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {mining: 88, thieving: 66}});
  planner.marketUnitValue = (_p, id) => id === 2 ? 66 : id === 1002 || id === 2002 ? 1e6 : null;
  const tin = planner.saleJobs(p).find(r => d.jobs.find(j => j.id === r.jobId).output.itemId === 2);
  assert.ok(tin && tin.rate > 0 && tin.rate < 1000, `tin at ${tin?.rate} gold/s, quality ore not counted`);
});
