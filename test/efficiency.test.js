import test from 'node:test';
import assert from 'node:assert/strict';
import {COMBAT_SKILLS, combatKey, equipmentKey, jobKey, levelsKey} from '../src/planner/keys.js';
import {buffKey} from '../src/planner/supplies.js';
import {makePlanner, player} from './helpers.js';

// Every rate is the game's formula (the expected value); a measurement or an
// engine simulation only marks a route that died in this state.
function record(planner, p, key, skills, extra) {
  const lv = planner.levels(p);
  return {[key]: {equipmentKey: equipmentKey(p), levelsKey: levelsKey(skills, s => lv[s]),
    buffKey: buffKey(planner.data, p), seconds: 3600, travelSeconds: 0, samples: 10, xp: 1e9, coins: 0, ...extra}};
}

test('a measured stretch moves no rate: gathering, crafting and fights are the formula', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {mining: 20, smithing: 20}, lastTick: 1000});
  for (const job of [d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1 && !j.inputs.length),
    d.jobs.find(j => j.skill === 'smithing' && j.levelReq === 1 && j.inputs.length)]) {
    const formula = planner.byFormula(() => planner.estimateWork(p, job));
    planner.setMeasurements(record(planner, p, jobKey(job.id), [job.skill]));
    assert.deepEqual(planner.estimateWork(p, job), formula, job.skill);
  }
});

test('a route that died in this state is worthless; at another level it is the formula again', () => {
  const planner = makePlanner(), d = planner.data;
  const weapon = d.gear.find(g => g.slot === 'weapon' && !g.magic && !g.ranged && (g.levelReq ?? 1) <= 1)?.itemId;
  const p = player(planner, {levels: {melee: 30, hitpoints: 30, defence: 30}, lastTick: 1000, equipment: {weapon}});
  const fights = q => planner.combatOptions(q, 'melee');
  const safe = fights(p)[0];
  assert.ok(safe?.xp > 0, 'a fight the formula calls safe');
  planner.setMeasurements(record(planner, p, combatKey(safe.monster.id), COMBAT_SKILLS, {deaths: 1, simulated: true}));
  assert.equal(fights(p).find(o => o.monster.id === safe.monster.id).xp, 0, 'it died in this state');
  assert.ok(planner.byFormula(() => fights(p)).find(o => o.monster.id === safe.monster.id).xp > 0, 'gear comparisons skip the check');
  const stronger = player(planner, {levels: {melee: 31, hitpoints: 30, defence: 30}, lastTick: 1000, equipment: {weapon}});
  assert.ok(fights(stronger).find(o => o.monster.id === safe.monster.id).xp > 0, 'a level later the record no longer applies');
});
