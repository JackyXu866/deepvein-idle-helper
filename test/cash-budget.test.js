import test from 'node:test';
import assert from 'node:assert/strict';
import {createEconomy} from '../src/economy/economy.js';
import {makePlanner, player} from './helpers.js';

// A herblore development goal while the worn Cobalt blade is worth enhancing:
// the plan keeps the enhancement's gold in its cash budget. Maintenance runs
// every few seconds; the budget once grew by that gold on every pass (live:
// 1,024,020,000 coins), so the plan kept earning gold forever.
function setup() {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const find = (slot, name) => d.gear.find(g => g.slot === slot && d.items[g.itemId].name.startsWith(name)).itemId;
  const p = player(planner, {levels: {melee: 62, defence: 60, hitpoints: 62, mining: 55, smithing: 62, thieving: 50, herblore: 60}, coins: 20000, hp: 600,
    equipment: {weapon: find('weapon', 'Cobalt blade'), helmet: find('helmet', 'Cobalt helm'), pickaxe: find('pickaxe', 'Cobalt')},
    activity: 'idle', path: null, held: false});
  const goal = {skill: 'herblore', target: 70, development: true, growth: true, budget: {coins: 500, items: {}}};
  return {planner, d, p, goal, economy: createEconomy(d, planner, {})};
}

test('the cash budget holds the enhancement gold once, however often maintenance runs', () => {
  const {p, goal, economy} = setup();
  economy.maintenance(p, goal, 'melee', 'balanced');
  assert.ok(goal.enhancement?.gold > 0, 'an enhancement is budgeted');
  const once = goal.budget.coins;
  assert.equal(once, 500 + goal.enhancement.gold);
  for (let i = 0; i < 5; i++) economy.maintenance(p, goal, 'melee', 'balanced');
  assert.equal(goal.budget.coins, once);
});

test('a plan short of cash earns it on the gold-rate job with its sales, not at a coin stall', () => {
  const {planner, d, p} = setup();
  const ore = d.jobs.filter(j => j.skill === 'mining' && j.levelReq <= 55 && !j.inputs.length).sort((a, b) => b.levelReq - a.levelReq)[0];
  // The gold table's top lasting row: that ore, sold (a coin stall pays less).
  planner.incomeRows = () => [{key: `job:${ore.id}`, recipeId: ore.id, monsterId: null, rarity: 0, skill: 'mining', xp: 1, coins: 50,
    oneOff: false, goldRate: true, saleItems: [ore.output.itemId]}];
  const goal = {skill: 'herblore', target: 70, development: true, growth: true, budget: {coins: 5_000_000, items: {}}};
  const plan = planner.plan(p, goal, 'melee');
  assert.match(plan.reason, /金币效率最高/, plan.reason);
  assert.deepEqual(goal.cashSales, [ore.output.itemId], 'its ore is sold while the plan is short');
  const stall = d.jobs.filter(j => j.output.itemId === d.coinId).map(j => j.id);
  assert.ok(!(plan.intent?.t === 'setRoute' && stall.includes(plan.intent.jobId)), JSON.stringify(plan.intent));
  // Enough cash: the sales stop.
  planner.plan({...p, coins: 6_000_000}, goal, 'melee');
  assert.equal(goal.cashSales, undefined);
});

test('one way to earn gold: business mode waiting on its trade works the gold-rate row too', () => {
  const {planner, p} = setup();
  const deferred = {mining: true};
  const earn = planner.earningGoal(p, 'melee', deferred);
  const goal = planner.specialistChooseGoal(p, {}, deferred, 'melee', 'mining');
  assert.ok(goal?.temporary, JSON.stringify(goal?.reason));
  assert.deepEqual([goal.recipeId ?? null, goal.monsterId ?? null], [earn.recipeId ?? null, earn.monsterId ?? null]);
  assert.deepEqual(goal.saleItems, earn.saleItems);
  assert.equal(planner.goldJobs, undefined, 'no second notion of how gold is earned');
});

test('the gold rate is the gold table\'s top row from the first table on', () => {
  const {planner, p} = setup();
  const rate = planner.coinRate(p);
  assert.equal(rate, planner.incomeRows(p, 'melee').find(r => r.goldRate).coins);
});

test('a budget already inflated by the old repeat is brought back to the plan\'s own coins', () => {
  const {p, goal, economy} = setup();
  economy.maintenance(p, goal, 'melee', 'balanced');
  const gold = goal.enhancement.gold;
  goal.budget.coins = 1_024_020_000; // saved by an older build
  delete goal.budget.enhancementGold;
  economy.maintenance(p, goal, 'melee', 'balanced');
  assert.ok(goal.budget.coins <= 500 + gold, `${goal.budget.coins}`);
});
