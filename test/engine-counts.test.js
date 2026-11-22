import test from 'node:test';
import assert from 'node:assert/strict';
import {countsApi, engineApi, engineReady, engineStatus, loadEngine} from '../src/engine/runtime.js';

// 2026-11-10 and 2026-11-21: a client update added state the smoke test's
// character lacked; the engine went off whole and no mastery point was spent.
// The simulation may fail its smoke test; the engine's pure counts stay.
const factory = ({smoke = false, counts = true} = {}) => `
  const f = () => null;
  return {tick: (a, b, c, d) => null, predict: f, startFight: f, startWork: f, createContext: f, maxHp: f, homeBank: f,
    combatTargetTile: f, hotSkill: f, levelXp: f, world: {zones: [{monsterId: 1}]}, tickMs: 600,
    ${smoke ? '' : 'allSkills: undefined,'}
    ${counts ? 'masteryEarnedPoints: p => 42, masteryTracks: [{id: "xp"}],' : ''}};`;

test('a failed smoke test turns the simulation off but keeps the mastery counts', () => {
  loadEngine({id: 'client-a', factory: factory()});
  assert.equal(engineReady(), false, 'no simulation');
  assert.equal(engineApi(), null);
  assert.equal(countsApi()?.masteryEarnedPoints({}), 42, 'mastery points still counted');
  assert.equal(engineStatus().counts, true);
  assert.ok(engineStatus().error);
  loadEngine({id: 'client-b', factory: factory({counts: false})});
  assert.equal(countsApi(), null, 'an engine without the count has none');
  loadEngine({id: 'client-c', factory: 'return {};'});
  assert.equal(countsApi(), null, 'a malformed engine is not used at all');
});
