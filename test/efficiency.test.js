import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentKey, jobKey, levelsKey} from '../src/planner/keys.js';
import {buffKey} from '../src/planner/supplies.js';
import {makePlanner, player} from './helpers.js';

// A measured route at `ratio` times the formula's XP rate, over `seconds`.
function measure(planner, p, job, ratio, seconds) {
  const formula = planner.byFormula(() => planner.estimateWork(p, job));
  const lv = planner.levels(p);
  return {[jobKey(job.id)]: {equipmentKey: equipmentKey(p), levelsKey: levelsKey([job.skill], s => lv[s]),
    buffKey: buffKey(planner.data, p), seconds, travelSeconds: 0, samples: 10,
    xp: formula.xp / formula.seconds * seconds * ratio, coins: 0}};
}

test('a task keeps its learnt efficiency after a level-up, and one short sample barely moves it', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1 && !j.inputs.length);
  const p = player(planner, {levels: {mining: 20}, lastTick: 1000});
  planner.setMeasurements(measure(planner, p, job, 1.5, 3600));
  const ratio = p => planner.estimateWork(p, job).xp / planner.byFormula(() => planner.estimateWork(p, job)).xp;
  assert.ok(Math.abs(ratio(p) - 1.5) < 1e-9, 'learnt from an hour of mining');

  const levelled = player(planner, {levels: {mining: 21}, lastTick: 1100});
  planner.setMeasurements({});
  assert.ok(Math.abs(ratio(levelled) - 1.5) < 1e-9, 'a level-up keeps it instead of the bare formula');
  assert.equal(planner.rateSource(levelled, jobKey(job.id)), 'averaged');

  planner.setMeasurements(measure(planner, levelled, job, .5, 60));
  const after = ratio(levelled);
  assert.ok(after > 1.45 && after < 1.5, `a noisy minute barely moves it: ${after}`);
});

test('the efficiency fades with a one-day half-life and survives a planner restart', () => {
  const planner = makePlanner(), d = planner.data, tickPerDay = 86400000 / d.tickMs;
  const job = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1 && !j.inputs.length);
  const p = player(planner, {levels: {mining: 20}, lastTick: 1000});
  planner.setMeasurements(measure(planner, p, job, 2, 3600));
  planner.estimateWork(p, job);
  const saved = planner.runtime().efficiency;
  const fresh = makePlanner();
  fresh.runtime({...fresh.runtime(), efficiency: JSON.parse(JSON.stringify(saved))});
  const later = player(fresh, {levels: {mining: 20}, lastTick: 1000 + tickPerDay});
  // After the restart the session's measurement starts again: 10 minutes so far.
  fresh.setMeasurements(measure(fresh, later, job, 1, 600));
  const ratio = fresh.estimateWork(later, job).xp / fresh.byFormula(() => fresh.estimateWork(later, job)).xp;
  // A day later the old hour weighs half (1800 s) against 600 new seconds.
  assert.ok(Math.abs(ratio - (2 * 1800 + 600) / 2400) < 1e-9, `${ratio}`);
});
