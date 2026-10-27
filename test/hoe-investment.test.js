import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {createEconomy} from '../src/economy/economy.js';
import {wirePlanner} from '../src/economy/wiring.js';
import {harvestCrops} from '../src/planner/farming.js';
import {makePlanner, player} from './helpers.js';

// Client 1.0.1202: a hoe's bonus is extra crops per harvest. A farmer at
// Farming 60 with every unlocked field growing a crop that sells for 500, in
// a Bronze hoe (+8%); a Cobalt hoe (+35%, Farming 60) is on the market.
const CROP_PRICE = 500;
function farmer(planner, extra = {}) {
  const d = planner.data;
  const crop = d.jobs.filter(j => j.grow && j.levelReq <= 60).sort((a, b) => b.levelReq - a.levelReq)[0];
  const bank = d.banks[0];
  const p = player(planner, {levels: {farming: 60, fletching: 85, thieving: 60}, coins: 5_000_000,
    equipment: {hoe: 385}, x: bank.x, y: bank.y, path: null, activity: 'idle', lastTick: 100000, ...extra});
  const fields = planner.farmFields(p); // a skill-gated field included
  p.plots = Object.fromEntries(fields.map(f => [f.id, {seedItemId: crop.inputs[0].itemId, plantedAt: 0}]));
  planner.marketUnitValue = (_p, id) => planner.base(id) === crop.output.itemId ? CROP_PRICE : 0;
  return {p, crop, fields};
}

test('the table values a better hoe by its extra crops\' gold over its use', () => {
  const planner = makePlanner(), d = planner.data;
  const {p, crop, fields} = farmer(planner);
  planner.coinRate = () => 100;
  planner.marketAsk = (_p, id) => id === 388 ? 50_000 : null;
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'hoe' && r.id === 388);
  assert.ok(row, 'a Cobalt hoe row');
  const perSecond = bonus => fields.length * harvestCrops(60, bonus) * CROP_PRICE / (crop.grow * d.tickMs / 1000);
  const extra = perSecond(planner.equipmentStats(388).bonus) - perSecond(planner.equipmentStats(385).bonus);
  assert.ok(Math.abs(row.saved - extra * row.useSeconds / 100) < 1e-6, 'extra gold over its use, as time at the gold rate');
  assert.equal(row.paid, 500, '50,000 gold at 100 a second');
  assert.equal(row.source, '市场');
  // Gold against gold: worth it only when the extra crops over its use bring
  // the price back with the margin (the gold rate cancels out).
  assert.equal(row.worth, extra * row.useSeconds >= 50_000 * 1.2);
  const dear = makePlanner();
  dear.coinRate = () => 100;
  dear.marketAsk = (_p, id) => id === 388 ? Math.ceil(extra * row.useSeconds / 1.2) + 1 : null;
  const same = farmer(dear);
  assert.equal(dear.investmentOptions(same.p, 'melee', null).find(r => r.slot === 'hoe' && r.id === 388)?.worth, false,
    'priced just above what its crops repay');
});

// Plans `goal` until it buys, answering the market's quote queries as the game would.
function buysHoe(goalOf) {
  const planner = makePlanner(), d = planner.data;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock}), economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => true);
  market.configureProcurement({enabled: true});
  const {p} = farmer(planner);
  planner.coinRate = () => 100;
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  const items = {};
  for (const hoe of [385, 386, 387, 388, 389]) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++)
    items[hoe + r * d.rarityScale + plus * d.plusScale] = {sellQty: 0};
  items[388] = {lowestSell: 50_000, sellQty: 1};
  for (const g of d.gear) for (let r = 0; r <= 4; r++) for (let plus = 0; plus <= 5; plus++) // nothing else on sale
    items[g.itemId + r * d.rarityScale + plus * d.plusScale] ??= {sellQty: 0};
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(), items});
  planner.marketUnitValue = (_p, id) => planner.base(id) === farmer(makePlanner()).crop.output.itemId ? CROP_PRICE : 0;
  const pick = planner.investmentOptions(p, 'melee', {skill: 'thieving'}).find(r => r.slot === 'hoe' && r.cheapest);
  assert.equal(pick?.id, 388, JSON.stringify(pick));
  // The buy checks the live ask first: answer the market's queries as the game would.
  const goal = goalOf(d);
  let plan;
  for (let i = 0; i < 5 && plan?.intent?.t !== 'marketBuy'; i++) {
    plan = planner.plan(p, goal, 'melee');
    const q = market.query(p);
    if (q?.t === 'marketDepth') market.receive({tick: p.lastTick + 1, m: [{t: 'marketDepth', itemId: q.itemId, bids: [],
      asks: q.itemId === 388 ? [{price: 50_000, qty: 1}] : [], trades: []}]});
    if (q?.t === 'marketBooks') market.receive({tick: p.lastTick + 1,
      m: q.itemIds.map(id => ({t: 'marketBook', itemId: id, ask: id === 388 ? {price: 50_000, qty: 1} : null}))});
    clock += 1500;
  }
  assert.deepEqual(plan?.intent, {t: 'marketBuy', itemId: 388, qty: 1, price: 50_000}, JSON.stringify([plan?.label, plan?.reason]));
}

test('the plan buys the hoe the table picks, whatever is being trained', () =>
  buysHoe(() => ({skill: 'thieving', target: 61, budget: {coins: 0, items: {}}})));

// Live: the table said 值得，可做 for an epic Meteoric hoe while the plan was
// cutting Yew for another goal, and it never bought it: supply work only
// looked at owned swaps.
test('supply work for another goal buys the table\'s hoe too', () => buysHoe(d => {
  const fletch = d.jobs.find(j => j.skill === 'fletching' && j.inputs.length === 1 && j.inputs[0].itemId === 10);
  return {skill: 'fletching', target: 86, recipeId: fletch.id, recipes: {fletching: fletch.id}, budget: {coins: 0, items: {}}};
}));

test('a better hoe held is put on', () => {
  const planner = makePlanner();
  const {p} = farmer(planner, {bank: {388: 1}});
  planner.coinRate = () => 100;
  const plan = planner.plan(p, {skill: 'thieving', target: 61, budget: {coins: 0, items: {}}}, 'melee');
  assert.ok(plan?.intent?.itemId === 388 || /已持有更好的/.test(plan?.reason ?? ''), JSON.stringify([plan?.intent, plan?.reason]));
});

test('a hoe enhancement is a table row the enhancement step can take', () => {
  const planner = makePlanner();
  const {p} = farmer(planner, {equipment: {hoe: 388}});
  planner.coinRate = () => 100;
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'hoe' && r.kind === 'enhance');
  assert.ok(row && row.gain > 0, JSON.stringify(row));
});
