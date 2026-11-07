import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInventory} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

test('quality output of an endless route is judged as it comes; a batch with an end holds it', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length), site = d.sites.find(s => s.jobIds.includes(job.id));
  const uncommon = job.output.itemId + d.rarityScale;
  const p = limit => player(planner, {bank: {[uncommon]: 500}, route: {siteId: site.id, jobId: job.id, onFull: 'bank', limit, phase: 'working'}});
  const row = limit => reviewInventory(d, planner, p(limit), null, 'melee').items.find(r => r.itemId === uncommon);
  assert.match(row(50).reason, /当前批次/);
  assert.doesNotMatch(row(null).reason, /当前批次/);
  assert.ok(row(null).sell > 0, row(null).reason);
});
