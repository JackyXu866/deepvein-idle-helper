import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from '../src/economy/market.js';
import {createEconomy} from '../src/economy/economy.js';
import {wirePlanner} from '../src/economy/wiring.js';
import {makePlanner, player} from './helpers.js';

// Thieving 66 at the Gem stall in common Chitin gloves +5; common Bone gloves
// sell for 89,000 (+1%), rare ones for 220,000 (+13%).
const ASKS = {326: 89000, 2326: 220000};
const thief = planner => player(planner, {levels: {thieving: 66, crafting: 72}, coins: 8_000_000, equipment: {gloves: 50325},
  route: {jobId: 242, siteId: 82, limit: 0, onFull: 'bank', phase: 'working'}, activity: 'working', path: null});

test('the investment table weighs every quality: rare Bone gloves, not the cheapest that beats', () => {
  const planner = makePlanner();
  planner.marketAsk = (_p, id) => ASKS[id] ?? null;
  const rows = planner.investmentOptions(thief(planner), 'melee', {skill: 'thieving', recipeId: 242}).filter(r => r.slot === 'gloves');
  const best = rows.find(r => r.cheapest);
  assert.equal(best?.id, 2326, JSON.stringify(rows.map(r => [r.id, r.net])));
  assert.ok(best.worth && best.gain > .1);
});

for (const kind of ['temporary', 'developmentFiller']) test(`${kind} work still buys a worthwhile tool on the market`, () => {
  const planner = makePlanner(), d = planner.data;
  let clock = 1_000_000_000;
  const market = createMarket(d, planner, {now: () => clock}), economy = createEconomy(d, planner, {});
  wirePlanner(planner, market, () => economy, () => true);
  market.configureProcurement({enabled: true});
  const p = thief(planner);
  market.receive({tick: p.lastTick, m: [{t: 'welcome', you: p, orders: []}]});
  market.setPriceFeed({generatedAt: new Date(clock).toISOString(),
    items: Object.fromEntries(Object.entries(ASKS).map(([id, ask]) => [id, {lowestSell: ask, sellQty: 1, highestBuy: null, buyQty: 0}]))});
  const goal = {skill: 'thieving', target: 75, budget: {coins: 0, items: {}}, [kind]: true};
  for (let i = 0; i < 4; i++) {
    planner.plan(p, goal, 'melee');
    const q = market.query(p);
    if (q?.t === 'marketDepth') market.receive({tick: p.lastTick + 1, m: [{t: 'marketDepth', itemId: q.itemId, bids: [],
      asks: ASKS[q.itemId] ? [{price: ASKS[q.itemId], qty: 1}] : [], trades: []}]});
    if (q?.t === 'marketBooks') market.receive({tick: p.lastTick + 1,
      m: q.itemIds.map(id => ({t: 'marketBook', itemId: id, ask: ASKS[id] ? {price: ASKS[id], qty: 1} : null}))});
    clock += 1500;
  }
  const atBank = {...p, x: d.banks[0].x, y: d.banks[0].y, route: null, activity: 'idle'};
  const plan = planner.plan(atBank, goal, 'melee');
  assert.deepEqual(plan?.intent, {t: 'marketBuy', itemId: 2326, qty: 1, price: 220000}, JSON.stringify(plan));
});
