import test from 'node:test';
import assert from 'node:assert/strict';
import {profitFrontier} from '../src/planner/plan-view.js';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// What the panel shows must be what the helper does.

test('a profit-floor button names the job that floor actually picks', () => {
  const rows = [{label: 'A', xpH: 100000, coinsH: 1250}, {label: 'B', xpH: 90000, coinsH: 1290}, {label: 'C', xpH: 120000, coinsH: 0}];
  for (const point of profitFrontier(rows)) {
    const best = rows.filter(r => r.coinsH >= point.floor).sort((a, b) => b.xpH - a.xpH)[0];
    assert.equal(point.label, best.label, `floor ${point.floor}`);
  }
});

test('a deferred quest shows as set aside, not as ready to do', () => {
  const planner = makePlanner(), d = planner.data;
  const job = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1 && !j.inputs.length);
  const p = player(planner, {levels: {mining: 50}, quests: {day: 0, week: 0, weekly: [],
    daily: [{id: 'd', kind: 'gather', jobId: job.id, goal: 10, done: 0, claimed: false, reward: {coins: 1, xp: 1, skill: 'mining'}}]}});
  const [row] = planner.questOverview(p, 'melee', {'daily:0:d': 1e12});
  assert.match(row.status, /暂缓/);
});

test('the business-trade status preview leaves the trade focus as it was', () => {
  const planner = makePlanner();
  const p = player(planner, {levels: {mining: 30, thieving: 30}});
  planner.specialistChooseGoal(p, {}, {}, 'melee', 'mining');
  const before = JSON.stringify(planner.runtime().specialization);
  planner.specialistPreviewGoal(p, {}, {}, 'melee', 'thieving');
  assert.equal(JSON.stringify(planner.runtime().specialization), before);
});

test('the sale list marks exactly what maintenance sells under the current settings', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const planner = makePlanner(), d = planner.data;
  const economy = createEconomy(d, planner, {autoSell: false, capacitySales: false, sellCrafted: true});
  const bar = d.jobs.find(j => j.name === 'Bronze bar').output.itemId, ore = d.jobs.find(j => j.skill === 'mining' && j.levelReq === 1).output.itemId;
  const p = player(planner, {levels: {smithing: 10}, bank: {[bar]: 300, [ore]: 300}});
  const rows = economy.review(p, null, 'melee').items;
  assert.equal(rows.find(r => r.itemId === bar).autoSold, true, 'crafted surplus is sold with 出售制作品 on');
  assert.equal(rows.find(r => r.itemId === ore).autoSold, false, 'raw surplus is not, with everyday selling off');
});

test('the farm status names the crop harvest would sow: one the plan needs first', () => {
  const planner = makePlanner(), d = planner.data;
  const crops = d.jobs.filter(j => j.grow && j.levelReq <= 30).sort((a, b) => b.xp / b.grow - a.xp / a.grow);
  const needed = crops.at(-1);
  const p = player(planner, {levels: {farming: 30}});
  const goal = {skill: 'cooking', budget: {coins: 0, items: {[needed.output.itemId]: 10}}};
  assert.equal(planner.farmStatus(p, goal).selectedName, needed.name);
});

test('a potion left unbought because every ask is above its value names that reason', () => {
  const planner = makePlanner(), d = planner.data;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const p = player(planner, {lastTick: 100000, coins: 1_000_000, x: d.banks[0].x, y: d.banks[0].y, path: null});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items: {225: {lowestSell: 999999, sellQty: 10, highestBuy: null, buyQty: 0}}});
  const status = market.potionStatus(p, 225, null, 20, 1000);
  assert.match(status.message, /高于药效价值上限/, status.message);
});
