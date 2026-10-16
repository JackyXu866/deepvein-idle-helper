import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

const SWIFT = 225;

test('a swift draught at market price is bought when its saved time is worth it, not by base value', () => {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 100;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const p = player(planner, {lastTick: 100000, coins: 1_000_000, x: d.banks[0].x, y: d.banks[0].y, path: null});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {[SWIFT]: {lowestSell: 1980, sellQty: 2626, highestBuy: 1800, buyQty: 7059}}});
  market.watchPotions(p, [SWIFT]);
  let query = null;
  for (let i = 0; i < 6 && query?.t !== 'marketDepth'; i++) { query = market.query(p); clock += 5000; }
  assert.deepEqual(query, {t: 'marketDepth', itemId: SWIFT});
  market.receive({tick: 100001, m: [{t: 'marketDepth', itemId: SWIFT, bids: [{price: 1800, qty: 7059}], asks: [{price: 1980, qty: 2626}], trades: []}]});
  assert.ok(1980 > d.items[SWIFT].value * 3, 'the market price is far above 3x base value');
  assert.equal(market.restockPotion(p, SWIFT, null, 20, [], null), null, 'unknown worth: the old cap refuses it');
  const bought = market.restockPotion(p, SWIFT, null, 20, [], 30000);
  assert.deepEqual(bought?.intent, {t: 'marketBuy', itemId: SWIFT, qty: 20, price: 1980}, JSON.stringify(bought));
  assert.equal(market.restockPotion(p, SWIFT, null, 20, [], 2000), null, 'worth 2,000 an hour does not repay 1,980 with margin');
});

function brewing() {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 100;
  const recipe = d.jobs.find(j => j.output.itemId === SWIFT);
  const ore = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1);
  const site = d.sites.find(s => s.jobIds.includes(ore.id));
  const bank = Object.fromEntries(recipe.inputs.map(i => [i.itemId, 8]));
  const p = player(planner, {levels: {herblore: 53, mining: 50}, x: d.banks[0].x, y: d.banks[0].y, bank, path: null, activity: 'idle'});
  const plan = {intent: {t: 'setRoute', siteId: site.id, jobId: ore.id, onFull: 'bank', limit: 100}, label: '采矿', reason: ''};
  return {planner, d, p, plan, recipe};
}

test('with Sage and Husk chitin held, missing swift draughts are brewed before buying', () => {
  const {planner, p, plan, recipe} = brewing();
  const result = planner.consumable(p, null, 'melee', plan);
  assert.equal(result?.intent?.t, 'setRoute', JSON.stringify(result));
  assert.equal(result.intent.jobId, recipe.id);
  assert.equal(result.intent.limit, 8, 'as many as the held ingredients make');
  assert.deepEqual(result.potionBrew, {jobId: recipe.id});
});

test('the brew runs to its end before the plan resumes', () => {
  const {planner, d, p, recipe} = brewing();
  const t = new Trainer(d, planner, () => {}, () => 1e9);
  Object.assign(t, {mode: 'balanced', style: 'melee', active: true, compatible: true, player: p});
  t.issue({intent: {t: 'setRoute', siteId: d.sites.find(s => s.jobIds.includes(recipe.id)).id, jobId: recipe.id, onFull: 'bank', limit: 8},
    label: '自制疾行药剂 × 8', potionBrew: {jobId: recipe.id}}, true);
  assert.equal(t.potionBrew?.jobId, recipe.id);
  // Heading to the bank for its ingredients: a task boundary the plan would otherwise take.
  t.player = {...p, route: {jobId: recipe.id, siteId: 1, phase: 'toBank', limit: 8, onFull: 'bank'}, activity: 'walking', path: [{x: 1, y: 1}]};
  t.pending = null; t.autoFallback = false;
  t.issue = plan => assert.ok(!['setRoute', 'fight', 'walk', 'clearRoute'].includes(plan.intent?.t), `the brew is not replaced: ${plan.label}`);
  t.advance();
  assert.match(t.message, /自制药水/);
  t.player = {...p, route: null};
  t.issue = () => {};
  t.advance();
  assert.equal(t.potionBrew, null, 'cleared when the brew ends');
});
