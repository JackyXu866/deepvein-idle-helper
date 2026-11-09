import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {makePlanner, player} from './helpers.js';

// An epic Cobalt pan at 67,000 against a rare one worn: about an hour of gold
// for a faster cooking tool worn for a day. The investment table calls it
// worthwhile; the buy step must reach the same verdict.
function setup() {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const clock = 1_000_000_000;
  planner.coinRate = () => 67000 / 3600; // the pan costs one hour of gold
  planner.acquireEstimate = () => ({seconds: Infinity});
  const market = createMarket(d, planner, {now: () => clock});
  market.configureProcurement({enabled: true});
  const p = player(planner, {lastTick: 100000, coins: 1_000_000, levels: {cooking: 64}, x: d.banks[0].x, y: d.banks[0].y, path: null,
    equipment: {pan: 363 + 2 * R}});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const epic = 363 + 3 * R;
  // Every quality and enhancement of the pan is in the feed (only the epic is on sale), so no quote is awaited.
  const items = {};
  for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[363 + r * R + plus * d.plusScale] = {sellQty: 0};
  items[epic] = {lowestSell: 67000, sellQty: 1};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  // The investment table's pick for the slot: the epic pan, an hour of gold for a day's +15%.
  const row = {id: epic, gold: 67000, label: '换 史诗 Cobalt pan', paid: 3600, saved: 3 * 3600, gain: .15};
  return {market, p, epic, row};
}

test('the buy step buys the piece the investment table picked', () => {
  const {market, p, epic, row} = setup();
  const result = market.equipmentPurchase(p, {skill: 'cooking', horizon: 1800, budget: {coins: 0, items: {}}}, 'melee', {ids: [363], row});
  // Decided to buy: the order goes out once the live ask is confirmed.
  assert.ok(result?.intent?.t === 'marketBuy' && result.intent.itemId === epic || /实时卖盘/.test(result?.reason ?? ''), JSON.stringify(result));
});

test('without a table pick (made, enhanced, or not worth it) nothing is bought', () => {
  const {market, p} = setup();
  assert.equal(market.equipmentPurchase(p, {skill: 'cooking', horizon: 1800, budget: {coins: 0, items: {}}}, 'melee', {ids: [363]}), null);
});

test('end to end: an epic pan the table calls not worth it (gold earns slowly) is not bought', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  const economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => false);
  market.configureProcurement({enabled: true});
  planner.coinRate = () => 0.2; // 67,000 gold is about four days of gold work
  const bank = d.banks[0];
  const p = player(planner, {lastTick: 100000, coins: 1_700_000, levels: {cooking: 64, fishing: 66}, hp: 100, x: bank.x, y: bank.y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {}});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const items = {};
  for (const base of [361, 362, 363, 364]) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[base + r * R + plus * d.plusScale] = {sellQty: 0};
  items[363 + 3 * R] = {lowestSell: 67000, sellQty: 1};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  const goal = {skill: 'cooking', target: 65, recipes: {cooking: 61}, budget: {coins: 0, items: {}}, development: true};
  const row = planner.investmentOptions(p, 'melee', goal).find(r => r.id === 363 + 3 * R);
  assert.ok(!row?.worth, JSON.stringify(row));
  const plan = planner.plan(p, goal, 'melee');
  assert.ok(!(plan?.intent?.t === 'marketBuy' && plan.intent.itemId === 363 + 3 * R), JSON.stringify([plan?.intent, plan?.reason]));
});

test('end to end: a cooking goal still in preparation buys the epic pan the table recommends', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  const economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => false);
  market.configureProcurement({enabled: true});
  planner.coinRate = () => 67000 / 3600;
  const cook = d.jobs.find(j => j.id === 61), bank = d.banks[0];
  const p = player(planner, {lastTick: 100000, coins: 1_700_000, levels: {cooking: 64, fishing: 66}, hp: 100, x: bank.x, y: bank.y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {}}); // Shrimp still to be caught, as for a held batch
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const items = {};
  for (const base of [361, 362, 363, 364]) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[base + r * R + plus * d.plusScale] = {sellQty: 0};
  items[363 + 3 * R] = {lowestSell: 67000, sellQty: 1};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  const goal = {skill: 'cooking', target: 65, recipes: {cooking: 61}, budget: {coins: 0, items: {}}, development: true};
  const plan = planner.plan(p, goal, 'melee');
  const text = JSON.stringify([plan?.intent, plan?.label, plan?.reason]);
  assert.ok(plan?.intent?.t === 'marketBuy' && plan.intent.itemId === 363 + 3 * R || /实时卖盘/.test(plan?.reason ?? ''), text);
});

test('the epic pan is bought at a task boundary even while the same cooking work continues', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  const economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => false);
  market.configureProcurement({enabled: true});
  planner.coinRate = () => 67000 / 3600;
  const cook = d.jobs.find(j => j.id === 61), bank = d.banks[0], site = d.sites.find(s => s.jobIds.includes(61));
  const p = player(planner, {lastTick: 100000, coins: 1_700_000, levels: {cooking: 64, fishing: 66}, hp: 100, x: bank.x, y: bank.y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {[cook.inputs[0].itemId]: 30000},
    route: {jobId: 61, siteId: site.id, zoneId: null, phase: 'toBank', limit: null, onFull: 'bank'}}); // a load done, on the bank trip
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const items = {};
  for (const base of [361, 362, 363, 364]) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[base + r * R + plus * d.plusScale] = {sellQty: 0};
  items[363 + 3 * R] = {lowestSell: 67000, sellQty: 1};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  const goal = {skill: 'cooking', target: 65, recipes: {cooking: 61}, recipeRarities: {cooking: 0}, recipeLevels: {cooking: 64},
    budget: {coins: 0, items: {}}, development: true};
  const plan = planner.plan(p, goal, 'melee', true);
  const text = JSON.stringify([plan?.intent, plan?.label, plan?.reason]);
  assert.ok(plan?.intent?.t === 'marketBuy' && plan.intent.itemId === 363 + 3 * R || /实时卖盘/.test(plan?.reason ?? ''), text);
});

test('the helper\'s own three sell listings do not block a purchase', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, clock = 1_000_000_000;
  planner.coinRate = () => 67000 / 3600;
  planner.acquireEstimate = () => ({seconds: Infinity});
  const store = new Map(), storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  const p = player(planner, {lastTick: 100000, coins: 5_000_000, levels: {cooking: 64}, x: d.banks[0].x, y: d.banks[0].y, path: null,
    equipment: {pan: 363 + 2 * R}});
  const listings = [[1, 2128, 16, 14800], [2, 52372, 1, 15200], [3, 1185, 2, 1200]].map(([id, itemId, qty, price]) =>
    ({id, itemId, side: 'sell', price, qtyTotal: qty, qtyRemaining: qty}));
  store.set('deepvein-market-v1', JSON.stringify({players: {[p.id]: {owned: Object.fromEntries(listings.map(o => [o.id, {...o, at: clock}])),
    attempt: null, income: 0, spent: 0, fillKeys: []}}}));
  const market = createMarket(d, planner, {now: () => clock, storage});
  market.configureProcurement({enabled: true});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: listings}]});
  const epic = 363 + 3 * R, items = {};
  for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[363 + r * R + plus * d.plusScale] = {sellQty: 0};
  items[epic] = {lowestSell: 64000, sellQty: 33};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  const row = {id: epic, gold: 64000, label: '换 史诗 Cobalt pan', paid: 3500, saved: 3 * 3600, gain: .15};
  const result = market.equipmentPurchase(p, {skill: 'cooking', horizon: 1800, budget: {coins: 0, items: {}}}, 'melee', {ids: [363], row});
  assert.ok(result?.intent?.t === 'marketBuy' || /实时卖盘/.test(result?.reason ?? ''), JSON.stringify(result));
});

test('a measured rate with bonuses does not hide the pan\'s gain (both sides by formula)', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const {wirePlanner} = await import('../src/economy/wiring.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock});
  const economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => false);
  market.configureProcurement({enabled: true});
  planner.coinRate = () => 18;
  const bank = d.banks[0];
  const p = player(planner, {lastTick: 100000, coins: 5_290_000, levels: {cooking: 63, fishing: 66}, hp: 100, x: bank.x, y: bank.y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {20: 32768, 25: 9000, [25 + R]: 800}});
  // Measured with potions and house bonuses: 1.5x the formula for the worn pan.
  const lobster = d.jobs.find(j => j.id === 66), lv = planner.levels(p);
  const e = planner.estimateWork(p, lobster);
  const measured = {samples: 6, seconds: 600, xp: 1.5 * e.xp / e.seconds * 600, coins: 0,
    equipmentKey: JSON.stringify(Object.keys(p.equipment).sort().map(k => [k, p.equipment[k]])), levelsKey: JSON.stringify([['cooking', lv.cooking]])};
  planner.setMeasurements({'job:66': measured});
  market.receive({tick: 100000, m: [{t: 'welcome', you: p, orders: []}]});
  const items = {};
  for (const base of [361, 362, 363, 364]) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) items[base + r * R + plus * d.plusScale] = {sellQty: 0};
  items[363 + 3 * R] = {lowestSell: 64000, sellQty: 33};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items}, clock);
  const goal = {skill: 'cooking', target: 65, development: true, growth: true, stage: 65, horizon: 7200, budget: {coins: 0, items: {}},
    recipes: {cooking: 66}, recipeRarities: {cooking: 0}, recipeLevels: {cooking: 63}};
  const plan = planner.plan(p, goal, 'melee');
  assert.ok(plan?.intent?.t === 'marketBuy' || /实时卖盘/.test(plan?.reason ?? ''), JSON.stringify([plan?.intent, plan?.label, plan?.reason]));
});
