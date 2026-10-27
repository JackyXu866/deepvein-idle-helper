import test from 'node:test';
import assert from 'node:assert/strict';
import {farmingStocks, harvestCrops} from '../src/planner/farming.js';
import {reviewInventory} from '../src/planner/inventory.js';
import {makePlanner, player} from './helpers.js';

// Client 1.0.1202: a harvest is 2 crops, plus 1 at Farming 25, 50, 75 and 99,
// plus the hoe's bonus as extra crops; tending's time cut has no cap.

test('crops per harvest: 2 plus one per threshold, plus the hoe', () => {
  assert.equal(harvestCrops(1), 2);
  assert.equal(harvestCrops(24), 2);
  assert.equal(harvestCrops(25), 3);
  assert.equal(harvestCrops(74), 4);
  assert.equal(harvestCrops(99), 6);
  assert.equal(harvestCrops(60, .5), 4.5, 'a Meteoric hoe: half a crop more on average');
  assert.equal(harvestCrops(60, 1.2, {minimum: true}), 5, 'what a field surely brings');
});

test('a growing field counts as the crops it surely brings, the hoe included', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.grow && j.levelReq <= 30 && d.jobs.some(h => h.skill === 'herblore' && h.inputs.some(i => i.itemId === j.output.itemId)));
  const field = d.sites.find(s => s.kind === 'field');
  const p = player(planner, {levels: {farming: 60, herblore: 60}, plots: {[field.id]: {seedItemId: job.inputs[0].itemId, plantedAt: 0}}});
  const lv = planner.levels(p), goal = {budget: {items: {[job.output.itemId]: 100}}};
  const uncovered = bonus => farmingStocks(d, p, lv, goal, null, bonus).find(r => r.job.id === job.id).plannedUncovered;
  assert.equal(uncovered(0), 100 - 4, 'Farming 60: four sure crops from the growing field');
  assert.equal(uncovered(1.2), 100 - 5, 'one more with a +1.2 hoe');
});

test('a tended field is cut by all its trim, with no cap', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.grow && j.levelReq === 1);
  const field = d.sites.filter(s => s.kind === 'field').sort((a, b) => a.id - b.id)[0];
  const trim = job.grow; // more than half the growth
  const p = player(planner, {levels: {farming: 1}, plots: {[field.id]: {seedItemId: job.inputs[0].itemId, plantedAt: 1000, trim}}});
  const [plot] = planner.farmPlots(p);
  assert.equal(plot.readyAt, 1000 + job.grow - trim);
});

test('the 物资 enhancement list is the investment table\'s rows: a hoe gains by its extra crops', () => {
  const planner = makePlanner(), d = planner.data;
  const hoe = d.gear.find(g => g.slot === 'hoe' && d.items[g.itemId].name === 'Cobalt hoe').itemId;
  const p = player(planner, {levels: {farming: 60, fletching: 60}, equipment: {hoe}});
  const listed = reviewInventory(d, planner, p, null, 'melee').enhancements;
  const rows = planner.investmentOptions(p, 'melee', null).filter(r => r.kind === 'enhance');
  assert.deepEqual(listed.map(e => [e.slot, e.toPlus, e.worth]), rows.map(r => [r.slot, r.toPlus, r.worth]));
  assert.ok(listed.find(e => e.slot === 'hoe')?.gain > 0, 'more crops per harvest');
});
