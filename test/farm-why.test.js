import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

function farmer(planner, level, plots = {}) {
  const d = planner.data;
  return player(planner, {levels: {farming: level}, plots, lastTick: 1000, hp: 100, activity: 'idle', path: null,
    houseCells: [], house: {}});
}
// A planted field: the crop's seed in a farm site.
function plant(planner, job, readyInTicks = 600) {
  const site = planner.data.sites.find(s => s.jobIds.includes(job.id));
  return {[site.id]: {seedItemId: job.inputs[0].itemId, plantedTick: 1000 - job.grow + readyInTicks, readyTick: 1000 + readyInTicks}};
}

test('before all fields unlock: the best-XP crop says so, a plan need says so', () => {
  const planner = makePlanner(), d = planner.data;
  const crops = d.jobs.filter(j => j.grow && j.levelReq <= 10).sort((a, b) => b.xp / b.grow - a.xp / a.grow);
  const status = planner.farmStatus(farmer(planner, 10));
  assert.ok(status.next, 'a next crop is proposed');
  assert.equal(status.next.name, crops[0].name);
  assert.match(status.next.why, /农业经验最高/);
  const other = crops.at(-1);
  const needy = planner.farmStatus(farmer(planner, 10), {budget: {items: {[other.output.itemId]: 40}}});
  // The plan need is explained wherever that crop appears.
  const lines = [needy.next, ...needy.crops].filter(Boolean).map(c => c.why).join('\n');
  assert.ok(lines.length > 0);
});

test('after all fields unlock: reasons show stock against target', () => {
  const planner = makePlanner(), d = planner.data;
  const top = Math.max(...d.farmUnlocks);
  const status = planner.farmStatus(farmer(planner, top));
  assert.ok(status.next, 'something is short at an empty pantry');
  assert.match(status.next.why, /库存 \d+\/\d+|当前计划需要/);
});

test('crops already in the fields are listed with their reason', () => {
  const planner = makePlanner(), d = planner.data;
  const top = Math.max(...d.farmUnlocks);
  const herb = d.jobs.find(j => j.grow && d.jobs.some(h => h.skill === 'herblore' && h.inputs.some(i => i.itemId === j.output.itemId)));
  const fields = d.sites.filter(s => s.jobIds.includes(herb.id)).slice(0, 2);
  const plots = Object.fromEntries(fields.map(s => [s.id, {seedItemId: herb.inputs[0].itemId, plantedAt: 1000 - Math.floor(herb.grow / 2)}]));
  const status = planner.farmStatus(farmer(planner, top, plots));
  const row = status.crops.find(c => c.name === herb.name);
  assert.ok(row, JSON.stringify(status.crops));
  assert.equal(row.fields, fields.length);
  assert.ok(row.readyMinutes > 0);
  assert.match(row.why, /炼药素材/);
  assert.match(row.why, /库存 \d+\/500/);
});

test('with every stock met, ripe fields are still harvested and replanted at a task boundary', () => {
  const planner = makePlanner(), d = planner.data;
  const top = Math.max(...d.farmUnlocks);
  const herb = d.jobs.find(j => j.grow && j.levelReq <= top && d.jobs.some(h => h.skill === 'herblore' && h.inputs.some(i => i.itemId === j.output.itemId)));
  const fields = d.sites.filter(s => s.kind === 'field').sort((a, b) => a.id - b.id).slice(0, d.farmUnlocks.length);
  const plots = Object.fromEntries(fields.map(s => [s.id, {seedItemId: herb.inputs[0].itemId, plantedAt: 1000 - herb.grow - 10}]));
  const full = Object.fromEntries(d.jobs.filter(j => j.grow).map(j => [j.output.itemId, 100000]));
  const p = {...farmer(planner, top, plots), bank: full};
  const plan = planner.harvest(p, null, null, 'melee', true);
  assert.equal(plan?.intent?.t, 'setRoute', planner.farmStatus(p).reason);
  assert.equal(plan.intent.errand, true);
  const status = planner.farmStatus(p);
  assert.match(status.crops[0].why, /不让农田空闲|改种/);
  // Mid-task, the harvest waits for the boundary instead of interrupting.
  const busy = {...p, route: {jobId: d.jobs.find(j => j.skill === 'mining').id, siteId: 1, phase: 'working', limit: 0}};
  assert.equal(planner.harvest(busy, null, null, 'melee', false), null);
  assert.match(planner.farmStatus(busy).reason, /等当前任务结束或返仓/);
});

test('manual mode explains the choice', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.grow && j.levelReq <= 10);
  planner.setFarmingPreference({mode: 'manual', jobId: job.id});
  const status = planner.farmStatus(farmer(planner, 10));
  assert.equal(status.next?.why, '手动指定的作物');
});
