import test from 'node:test';
import assert from 'node:assert/strict';
import {planView} from '../src/planner/plan-view.js';
import {makePlanner, player} from './helpers.js';

// One income table: the plan tab's gold/hour column and the gold rate the
// helper converts gold with are the same rows (planner.incomeRows).
function setup(values = {}) {
  const planner = makePlanner(), d = planner.data;
  planner.marketUnitValue = (_p, id) => values[id] ?? null;
  const p = player(planner, {levels: {smithing: 79, mining: 88, thieving: 66}, x: d.banks[0].x, y: d.banks[0].y});
  return {planner, d, p};
}

test('the gold rate is the best lasting row of the income table', () => {
  const {planner, p} = setup();
  const rows = planner.incomeRows(p, 'melee'), best = rows.find(r => r.goldRate);
  assert.ok(best, 'a gold-rate row');
  assert.equal(planner.coinRate(p), best.coins);
  assert.ok(rows.every(r => r.goldRate || r.oneOff || r.coins <= best.coins), 'nothing lasting earns more');
});

test('what the gold column shows is what the gold rate uses', () => {
  const {planner, p} = setup({2: 66, 2002: 4850});
  planner.styleHint = 'melee';
  const view = planView(planner.data, planner, {goal: null, style: 'melee', mode: 'balanced', deferred: {}}, p);
  const shown = view.goldCandidates.find(r => r.goldRate);
  assert.ok(shown, 'the gold-rate row is shown');
  assert.equal(shown.coinsH, planner.coinRate(p) * 3600);
});

test('selling ore and the quality ore it rolls raises the gold rate', () => {
  const base = setup(), sold = setup({2: 66, 1002: 180, 2002: 4850, 3002: 300000});
  assert.ok(sold.planner.coinRate(sold.p) > base.planner.coinRate(base.p));
});
