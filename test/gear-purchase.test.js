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
  // The planner's own estimate: 2 actions/s worn now, 2.3 with the epic pan, worn for a day.
  const evaluate = id => ({before: 2, after: id === epic ? 2.3 : 2, seconds: 0, horizon: 86400});
  return {market, p, epic, evaluate};
}

test('a tool upgrade that pays off over the time it is worn is bought', () => {
  const {market, p, epic, evaluate} = setup();
  const result = market.equipmentPurchase(p, {skill: 'cooking', horizon: 1800, budget: {coins: 0, items: {}}}, 'melee',
    {ids: [363], score: () => 1, evaluate, currentId: p.equipment.pan});
  // Decided to buy: the order goes out once the live ask is confirmed.
  assert.ok(result?.intent?.t === 'marketBuy' && result.intent.itemId === epic || /实时卖盘/.test(result?.reason ?? ''), JSON.stringify(result));
});

test('one that does not pay off over that time is still declined', () => {
  const {market, p, evaluate} = setup();
  const slight = id => ({...evaluate(id), after: 2.01});
  const result = market.equipmentPurchase(p, {skill: 'cooking', horizon: 1800, budget: {coins: 0, items: {}}}, 'melee',
    {ids: [363], score: () => 1, evaluate: slight, currentId: p.equipment.pan});
  assert.equal(result, null);
});
