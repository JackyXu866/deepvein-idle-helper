import test from 'node:test';
import assert from 'node:assert/strict';
import {profitFrontier} from '../src/planner/plan-view.js';
import {createMarket} from '../src/economy/market.js';
import {planEnhancement} from '../src/planner/enhancement.js';
import {combatEstimate} from '../src/planner/estimates.js';
import {combatStats} from '../src/planner/rates.js';
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

// A melee fighter in Cobalt (as in investment.test.js).
function fighter() {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const find = (slot, name) => d.gear.find(g => g.slot === slot && d.items[g.itemId].name.startsWith(name)).itemId;
  const p = player(planner, {levels: {melee: 62, defence: 60, hitpoints: 62, mining: 55, smithing: 62, thieving: 50}, coins: 20000, hp: 600,
    equipment: {weapon: find('weapon', 'Cobalt blade'), helmet: find('helmet', 'Cobalt helm'), pickaxe: find('pickaxe', 'Cobalt')},
    activity: 'idle', path: null, held: false});
  return {planner, d, p, find};
}

test('gear is rated with the food each kill costs: armour that only blocks hits is worth something', () => {
  const {planner, d, p} = fighter();
  // The hardest monster still kept fed; a Cobalt plate (38 defence, 13 accuracy).
  const monster = planner.combatOptions(p, 'melee').map(c => c.monster).filter(m => planner.combatRate(p, 'melee', m.id) > 0)
    .sort((a, b) => b.maxHit - a.maxHit)[0];
  const plate = d.gear.find(g => g.slot === 'body' && d.items[g.itemId].name === 'Cobalt plate').itemId;
  const worn = {...p.equipment, body: plate};
  const bare = planner.combatRate(p, 'melee', monster.id), armoured = planner.combatRate(p, 'melee', monster.id, worn);
  // Kill speed alone (the accuracy) is a smaller gain: the rest is food not needed.
  const killRate = equipment => {const e = combatEstimate(d, monster, combatStats(d, planner, p, 'melee', equipment)); return e.mainXp / e.seconds;};
  assert.ok(armoured / bare > killRate(worn) / killRate(p.equipment) + 1e-6, `${bare} -> ${armoured}`);
});

test('the investment table prices enhanced copies on the market, which the buy step may then buy', () => {
  const planner = makePlanner(), d = planner.data, P = d.plusScale;
  const plus5 = 326 + 5 * P; // common Bone gloves +5
  planner.marketAsk = (_p, id) => id === plus5 ? 60000 : null;
  const p = player(planner, {levels: {thieving: 66, crafting: 72}, coins: 8_000_000, equipment: {gloves: 50325},
    route: {jobId: 242, siteId: 82, limit: 0, onFull: 'bank', phase: 'working'}, activity: 'working', path: null});
  const rows = planner.investmentOptions(p, 'melee', {skill: 'thieving', recipeId: 242}).filter(r => r.slot === 'gloves');
  assert.ok(rows.some(r => r.id === plus5 && r.source === '市场'), JSON.stringify(rows.map(r => [r.id, r.source, r.net])));
});

test('enhancing follows the table: a worthwhile enhancement is not dropped by a separate stats check', () => {
  const {planner, d, p} = fighter();
  p.coins = 5_000_000; p.bank[d.shardId] = 10000;
  const rows = planner.investmentOptions(p, 'melee', null);
  const pick = rows.find(r => r.kind === 'enhance' && r.cheapest && r.affordable);
  const result = planEnhancement(d, planner, p, 'melee', null);
  if (pick) assert.equal(result.enhancement?.slot, pick.slot, JSON.stringify([pick.label, result.reason]));
  else assert.ok(!result.enhancement, result.reason);
});

test('one gear step on every slot: a better pickaxe held is put on while thieving', () => {
  const planner = makePlanner(), d = planner.data;
  const pick = name => d.gear.find(g => g.slot === 'pickaxe' && d.items[g.itemId].name === name).itemId;
  const bank = d.banks[0];
  const p = player(planner, {levels: {thieving: 60, mining: 60}, x: bank.x, y: bank.y, path: null, activity: 'idle',
    equipment: {pickaxe: pick('Iron pickaxe')}, bank: {[pick('Cobalt pickaxe')]: 1}});
  const row = planner.investmentOptions(p, 'melee', {skill: 'thieving'}).find(r => r.slot === 'pickaxe' && r.kind === 'owned');
  assert.ok(row?.cheapest, 'the table\'s pick for the pickaxe');
  const plan = planner.plan(p, {skill: 'thieving', target: 61, budget: {coins: 0, items: {}}}, 'melee');
  assert.ok(plan?.intent?.itemId === pick('Cobalt pickaxe') || /已持有更好的/.test(plan?.reason ?? ''), JSON.stringify([plan?.intent, plan?.reason]));
});

test('one investment table whoever reads it: the goal changes nothing but its project row', () => {
  const {planner, p} = fighter();
  const rows = goal => planner.investmentOptions(p, 'melee', goal).map(r => [r.slot, r.id, r.kind, Math.round(r.net), r.cheapest]);
  const panel = rows({skill: 'mining', recipeId: 1}), maintenance = rows({skill: 'melee', professionOnly: true}), funding = rows(null);
  assert.deepEqual(maintenance, panel);
  assert.deepEqual(funding, panel);
});

test('business mode funds a worthwhile unaffordable improvement too', () => {
  const {planner, p} = fighter();
  const funded = planner.fundingGoal(p, 'melee', {}, null);
  assert.ok(funded?.funding, 'something worth funding');
  const chosen = planner.selectGoal(p, {}, {}, 'melee', 'business', 'auto');
  assert.ok(chosen?.funding, JSON.stringify(chosen?.reason));
});

test('the sale review never sells the held piece the gear step would put on', async () => {
  const {reviewInventory} = await import('../src/planner/inventory.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, P = d.plusScale;
  const iron = d.gear.find(g => g.slot === 'pickaxe' && d.items[g.itemId].name === 'Iron pickaxe').itemId;
  // A common +5 against an uncommon +0 of the same pickaxe: rarity rank alone sold the +5.
  const p = player(planner, {levels: {mining: 40}, bank: {[iron + 5 * P]: 1, [iron + R]: 1}});
  const best = planner.ownedBest(p, 'melee', null, 'pickaxe');
  const row = reviewInventory(d, planner, p, null, 'melee').items.find(r => r.itemId === best);
  assert.equal(row?.sell, 0, `${best}: ${row?.reason}`);
});

test('one coin reserve: buying, housing and the sale review keep the same coins', async () => {
  const {coinReserve, combinedBudget, inventoryBudget} = await import('../src/planner/inventory.js');
  const planner = makePlanner(), d = planner.data;
  const market = createMarket(d, planner, {now: () => 1e12});
  market.configureProcurement({enabled: true});
  const p = player(planner, {coins: 10_000});
  planner.pendingEquipmentPlan = () => ({budget: {coins: 5000, items: {}}}); // a gear project in maintenance
  const goal = {skill: 'mining', budget: {coins: 1000, items: {}}};
  assert.equal(coinReserve(planner, p, goal), 6000);
  assert.equal(market.purchaseAllowance(p, goal), 4000, 'the market leaves the project\'s coins too');
  assert.equal(inventoryBudget(d, planner, p, goal).coins, 6000);
  assert.equal(combinedBudget(d, planner, p, [goal, planner.pendingEquipmentPlan()]).coins, 6000, 'housing');
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
