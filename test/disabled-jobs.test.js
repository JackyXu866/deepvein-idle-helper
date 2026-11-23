import test from 'node:test';
import assert from 'node:assert/strict';
import {DISABLED_JOBS, playableJob} from '../src/data/public-tables.js';
import {makePlanner, player} from './helpers.js';

// 2026-11-23: a Steel flask (alchemy, off in the client) was chosen for
// crafting XP; the server refused it (cannot-set-route) until the helper
// paused. The game refuses retired cooking (69-85) and the flasks (600-604).
test('jobs the game refuses are never in the data or among the candidates', () => {
  const planner = makePlanner(), d = planner.data;
  assert.ok(DISABLED_JOBS.has(602) && DISABLED_JOBS.has(84) && !DISABLED_JOBS.has(1));
  assert.equal(playableJob({id: 602}), false);
  assert.equal(playableJob({id: 600, retired: false}), false);
  assert.equal(playableJob({id: 5}), true);
  assert.deepEqual(d.jobs.filter(j => DISABLED_JOBS.has(j.id)).map(j => j.id), []);
  assert.ok(d.sites.every(s => s.jobIds.every(id => !DISABLED_JOBS.has(id))));
  const p = player(planner, {levels: {crafting: 60, cooking: 60}});
  assert.ok(!planner.candidates(p, 'melee', {}).some(c => DISABLED_JOBS.has(c.recipeId)));
});
