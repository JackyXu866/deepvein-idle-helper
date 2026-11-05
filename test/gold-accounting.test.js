import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// A bought input costs its coins once. The route estimate also turns them into
// time for the XP ranking (gold as time); that part is reported apart so what
// earns gold counts the real time and the coins only.
test('the gold table counts bought inputs once: their coins, not again as time', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.name === 'Cut gem');
  const rough = job.inputs[0].itemId;
  planner.coinRate = () => 10;
  planner.marketAllowance = () => 1e9;
  planner.marketBuyPrice = (_p, id) => id === rough ? 500 : Infinity;
  planner.inputCost = {...planner.inputCost, decide: () => ({buy: true}), producer: () => null};
  const p = player(planner, {levels: {crafting: 80}, coins: 1e9, x: d.banks[0].x, y: d.banks[0].y});
  const e = planner.routeEstimate(p, job, 10, {style: 'melee', buyInputs: true});
  assert.ok(e.boughtSeconds > 0, 'the purchase as time, kept apart');
  assert.equal(Math.round(-e.coins), 500 * 10, 'and its coins');
  const c = {recipeId: job.id, skill: job.skill, output: {itemId: job.output.itemId, qty: 10}, rate: e.rate, estimate: e, batch: 10};
  planner.marketUnitValue = (_p, id) => id === job.output.itemId ? 2000 : null;
  const row = planner.incomeChoices(p, [c], 'melee')[0];
  assert.ok(row, 'a gold row');
  assert.ok(Math.abs(row.rate.coins - (e.coins + row.marketProceeds) / (e.seconds - e.boughtSeconds)) < 1e-6,
    'gold per real second');
});

// XP is worth something only below the level cap: making from a maxed skill
// earns no credit, so buying is weighed fairly against it.
test('a maxed skill earns no XP credit in make-or-buy', () => {
  const planner = makePlanner(), d = planner.data, max = planner.maxLevel;
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.levelReq <= 1);
  const unit = levels => planner.inputCost.unitSeconds(player(planner, {levels}), job.output.itemId, 10, {style: 'melee'});
  assert.ok(unit({mining: max}) > unit({mining: max - 1}), 'the same ore costs more time once mining is maxed');
});
