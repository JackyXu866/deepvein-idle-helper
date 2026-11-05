import test from 'node:test';
import assert from 'node:assert/strict';
import {townOrders} from '../src/planner/town-orders.js';
import {validateIntent} from '../src/runtime/intents.js';
import {makePlanner, player} from './helpers.js';

const DAY = 308, DAY_TICKS = 144000;

// Live board on day 308 (城镇 → 订单): the same three for everyone.
test('the day\'s orders follow the client\'s draw', () => {
  const planner = makePlanner(), d = planner.data;
  assert.deepEqual(townOrders(d, DAY).map(o => [o.client, o.qty, d.items[o.itemId].name, o.coins]), [
    ['The brewer', 20, 'Pelt chaps', 1600],
    ['The lighthouse keeper', 5, 'Bogskin gloves', 80000],
    ['The inn', 5, 'Fur chaps', 32300]]);
});

function setup(extra = {}) {
  const planner = makePlanner(), d = planner.data;
  planner.coinRate = () => 50;
  const bank = d.banks[0];
  const p = player(planner, {levels: {crafting: 75, fletching: 75, smithing: 75, mining: 75, woodcutting: 75, melee: 60, defence: 60, hitpoints: 60},
    lastTick: DAY * DAY_TICKS + 1000, coins: 1_000_000, x: bank.x, y: bank.y, path: null, route: null, activity: 'idle',
    contracts: {day: DAY, done: []}, bank: {240: 300, 241: 300, 245: 300, 202: 300}, ...extra}); // the orders' hides and thread
  planner.stockSold = () => false; // everyday selling off: held inputs cost nothing to use
  return {planner, d, p, orders: townOrders(d, DAY)};
}

test('an order is taken when its pay beats making it, as time at the gold rate', () => {
  const {planner, p, orders} = setup();
  const goal = planner.questChooseGoal(p, null, 'melee', {});
  assert.ok(goal?.order, JSON.stringify(goal?.reason));
  const row = planner.orderOverview(p, 'melee', {}).find(r => r.slot === goal.order.slot);
  assert.equal(row.status, '值得，会做', 'the panel shows the verdict the choice used');
  assert.equal(goal.budget.items[goal.order.itemId], goal.order.qty, 'its pieces are reserved: never sold');
  assert.equal(goal.quest.period, 'order');
  // A slot delivered today, or an unknown delivery record, is never taken.
  const done = {...p, contracts: {day: DAY, done: orders.map(o => o.slot)}};
  assert.equal(planner.questChooseGoal(done, null, 'melee', {}), null);
  assert.equal(planner.questChooseGoal({...p, contracts: undefined}, null, 'melee', {}), null);
  // Assist mode takes no orders.
  assert.equal(planner.questChooseGoal(p, null, 'melee', {}, {orders: false}), null);
  // Done once the server lists the slot, or the day turns.
  assert.equal(planner.questCompleted({...p, contracts: {day: DAY, done: [goal.order.slot]}}, goal), true);
  assert.equal(planner.questCompleted({...p, lastTick: (DAY + 1) * DAY_TICKS}, goal), true);
  assert.equal(planner.questCompleted(p, goal), false);
});

test('an order that pays less than its making is left', () => {
  const {planner, p} = setup();
  planner.coinRate = () => 1e9; // every second is worth more than any pay
  assert.equal(planner.questChooseGoal(p, null, 'melee', {}), null);
  assert.ok(planner.orderOverview(p, 'melee', {}).every(r => /不回本|等级|地点|做不完/.test(r.status)));
});

test('held pieces are handed in at the counter, banked first when carried', () => {
  const {planner, p, orders} = setup();
  const o = orders[1];
  const goal = {skill: 'crafting', recipeId: o.jobId, batch: 0, order: {slot: o.slot, day: DAY, itemId: o.itemId, qty: o.qty, coins: o.coins},
    quest: {key: `order:${DAY}:${o.slot}`, period: 'order', jobId: o.jobId}, budget: {coins: 0, items: {[o.itemId]: o.qty}}};
  // With none held, the pieces are made: an order is not looked up on the
  // quest board (it used to wait there forever, leaving the account idle).
  const making = planner.plan(p, structuredClone(goal), 'melee');
  assert.ok(making.intent && !making.blocked, JSON.stringify([making.label, making.reason]));
  const banked = {...p, bank: {...p.bank, [o.itemId]: o.qty}};
  assert.deepEqual(planner.plan(banked, goal, 'melee').intent, {t: 'contract', slot: o.slot});
  const carried = {...p, bank: {...p.bank, [o.itemId]: 2}, pack: [{itemId: o.itemId, qty: o.qty - 2}]};
  assert.deepEqual(planner.plan(carried, goal, 'melee').intent, {t: 'depositItem', itemId: o.itemId, qty: o.qty - 2});
  // The command check: enough in the bank, at a counter, not delivered today.
  assert.equal(validateIntent(planner.data, banked, {t: 'contract', slot: o.slot}, {planner}), true);
  assert.equal(validateIntent(planner.data, p, {t: 'contract', slot: o.slot}, {planner}), false, 'not enough in the bank');
  assert.equal(validateIntent(planner.data, {...banked, contracts: {day: DAY, done: [o.slot]}}, {t: 'contract', slot: o.slot}, {planner}), false);
});

test('the growth loop takes a worthwhile order when no quest is open', async () => {
  const {Trainer} = await import('../src/runtime/trainer.js');
  const {planner, d, p, orders} = setup();
  const o = orders[1];
  planner.questRead = () => [];
  planner.taskBoundary = () => true;
  planner.harvest = () => null;
  const plan = planner.plan;
  planner.plan = (state, goal, ...rest) => goal?.order ? {intent: {t: 'setRoute', siteId: 1, jobId: goal.recipeId, limit: goal.batch}, label: 'order'} : plan(state, goal, ...rest);
  const t = new Trainer(d, planner, () => {}, () => 1e9);
  Object.assign(t, {mode: 'balanced', style: 'melee', active: true, compatible: true, player: p, autoFallback: false});
  t.issue = next => { t.plan = next; t.issued = next; };
  t.advance();
  assert.ok(t.goal?.order, JSON.stringify([t.goal?.reason, t.message]));
  assert.equal(t.issued?.intent?.jobId, t.goal.recipeId);
  assert.ok([o.slot, 2].includes(t.goal.order.slot));
});
