import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';
import {HORSE_ID, mountSupply, mountSupplyStep, totalLevel} from '../src/planner/mounts.js';
import {validateIntent} from '../src/runtime/intents.js';
import {acknowledged} from '../src/runtime/trainer.js';
import {planEnhancement} from '../src/planner/enhancement.js';
import {action} from '../src/planner/result.js';

// Market asks on 2026-11-05 (7-day averages; legendary's lowest ask 240M).
const ASKS = {328: 20000, 1328: 177000, 2328: 1770000, 3328: 18500000, 4328: 240000000};
const VETERAN = {mining: 60, smithing: 60, melee: 40, enhancing: 47};
function setup({asks = ASKS, levels = VETERAN, ...rest} = {}) {
  const planner = makePlanner();
  planner.marketAsk = (_p, id) => asks[id] ?? null;
  planner.stockSold = () => false; // mounts are protected: held ones give nothing up
  const p = player(planner, {levels, coins: 1e9, ...rest});
  return {planner, d: planner.data, p};
}
const bankAction = (_p, intent, label) => action(intent, label);

test('a mount of any quality is priced the cheapest way: the market, the merchant, or ten of the quality below', () => {
  const {planner, d, p} = setup();
  assert.ok(totalLevel(planner, p) >= 150);
  const legendary = mountSupply(d, planner, p, 4328);
  // Epic: 10 rares (1.77M each) = 17.7M beats its 18.5M ask; legendary: 10 epics = 177M beats 240M.
  assert.equal(legendary.source, '繁育');
  assert.equal(Math.round(legendary.gold), 177000000);
  assert.equal(legendary.breed[3], 1, 'ten epics bred into one legendary');
  assert.equal(legendary.breed[2], 10, 'a hundred rares bred into ten epics');
  // Uncommon on the market (177k) is cheaper than ten merchant horses (200k).
  assert.equal(mountSupply(d, planner, p, 1328).source, '市场');
  // Without the market's uncommon, the merchant's horses are bred instead.
  const vendor = setup({asks: {...ASKS, 1328: null}});
  const uncommon = mountSupply(vendor.d, vendor.planner, vendor.p, 1328);
  assert.equal(uncommon.vendor, 10);
  assert.equal(uncommon.gold, 200000);
});

test('held lower mounts count, and the merchant needs total level 150', () => {
  const {planner, d, p} = setup({bank: {3328: 4, 53328: 1}});
  // Five held epics (any +N, lowest first, as the game takes them): five more to breed or buy.
  const legendary = mountSupply(d, planner, p, 4328);
  assert.equal(Math.round(legendary.gold), 5 * 17700000);
  assert.equal(legendary.held[3328], 4);
  assert.equal(legendary.held[53328], 1, 'the +5 is taken after the +0s');
  // The worn mount is never bred.
  const worn = {...p, bank: {3328: 4}, equipment: {mount: 53328}};
  assert.equal(Math.round(mountSupply(d, planner, worn, 4328).gold), 6 * 17700000);
  const novice = setup({asks: {}, levels: {}});
  assert.ok(!Number.isFinite(mountSupply(novice.d, novice.planner, novice.p, HORSE_ID).gold), 'no merchant horse below total level 150');
});

test('the supply step buys the merchant\'s horses first, then breeds at the counter', () => {
  const {planner, d, p} = setup({asks: {}});
  const first = mountSupplyStep(d, planner, p, null, 'melee', 1328, {label: 'test', bankAction});
  assert.deepEqual(first.intent, {t: 'vendorBuy', itemId: HORSE_ID, qty: 10});
  assert.equal(validateIntent(d, p, first.intent, {planner}), true);
  const stocked = {...p, bank: {[HORSE_ID]: 12}};
  const next = mountSupplyStep(d, planner, stocked, null, 'melee', 1328, {label: 'test', bankAction});
  assert.deepEqual(next.intent, {t: 'breedMounts', itemId: HORSE_ID, times: 1});
  assert.equal(validateIntent(d, stocked, next.intent, {planner}), true);
  // Ten taken, one uncommon given: confirmed.
  assert.equal(acknowledged(stocked, {...stocked, bank: {[HORSE_ID]: 2, 1328: 1}}, next.intent, d), true);
  assert.equal(acknowledged(stocked, stocked, next.intent, d), false);
  // Not affordable as a whole: nothing starts.
  assert.equal(mountSupplyStep(d, planner, {...p, coins: 100000}, null, 'melee', 1328, {label: 'test', bankAction}), null);
});

test('mount intents are validated: merchant level, ten per breed, no breeding past legendary, legendary gear may be bought', () => {
  const {planner, d, p} = setup();
  const novice = setup({levels: {}});
  assert.equal(validateIntent(d, novice.p, {t: 'vendorBuy', itemId: HORSE_ID, qty: 5}, {planner: novice.planner}), false);
  assert.equal(validateIntent(d, p, {t: 'vendorBuy', itemId: HORSE_ID, qty: 101}, {planner}), false);
  assert.equal(validateIntent(d, {...p, bank: {2328: 9}}, {t: 'breedMounts', itemId: 2328, times: 1}, {planner}), false);
  assert.equal(validateIntent(d, {...p, bank: {2328: 9, 52328: 1}}, {t: 'breedMounts', itemId: 2328, times: 1}, {planner}), true);
  assert.equal(validateIntent(d, {...p, bank: {4328: 10}}, {t: 'breedMounts', itemId: 4328, times: 1}, {planner}), false);
  assert.equal(validateIntent(d, {...p, x: 0, y: 0, bank: {2328: 10}}, {t: 'breedMounts', itemId: 2328, times: 1}, {planner}), false);
  assert.equal(validateIntent(d, p, {t: 'marketBuy', itemId: 4328, qty: 1, price: 240000000}, {planner}), true);
  const ore = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length).output.itemId;
  assert.equal(validateIntent(d, p, {t: 'marketBuy', itemId: ore + 4 * d.rarityScale, qty: 1, price: 1000}, {planner}), false);
});

// The user's case: an epic +5 worn (x6.1). A legendary +0 is only x5, so the
// table weighs getting a legendary (bred: 177M) and enhancing it as one option.
function walker(extra = {}) {
  const s = setup({equipment: {mount: 53328}, ...extra});
  s.planner.coinRate = () => 1e6;
  s.planner.perkUsage = {'job:45': {seconds: 3600, travelSeconds: 1800}};
  return s;
}

test('the table weighs breeding a legendary mount and enhancing it, as one option', () => {
  const {planner, p} = walker();
  const rows = planner.investmentOptions(p, 'melee', null).filter(r => r.slot === 'mount');
  const row = rows.find(r => r.kind === 'acquireEnhance');
  assert.ok(row, JSON.stringify(rows.map(r => r.label)));
  assert.equal(row.start, 4328);
  assert.equal(row.source, '繁育');
  assert.ok(row.toPlus >= 2, 'a legendary beats the epic +5 only from +2');
  assert.equal(row.acquireGold, 177000000);
  assert.ok(row.gold > row.acquireGold, 'the enhancing is counted too');
  assert.ok(rows.some(r => r.kind === 'quality' && r.id === 4328 && r.source === '繁育') === false, 'a legendary +0 alone is slower than the worn mount');
});

test('a mount of the quality already worn is never bred or bought again at its +N or lower', () => {
  // 2026-11-08: an epic +4 worn, and a second epic +0 was bred to be enhanced past it.
  const {planner, p} = walker({equipment: {mount: 43328}});
  const rows = planner.investmentOptions(p, 'melee', null).filter(r => r.slot === 'mount');
  assert.ok(!rows.some(r => r.start === 3328 && r.kind !== 'enhance'), JSON.stringify(rows.map(r => r.label)));
  assert.ok(rows.some(r => r.kind === 'enhance' && r.start === 43328), 'the worn epic is enhanced instead');
});

test('end to end: the plan\'s gear step starts the breeding chain the table picked', () => {
  // No mount on the market: ten thousand merchant horses (200M) bred up to a legendary.
  const {planner, d, p} = walker({asks: {}});
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'mount' && r.cheapest);
  assert.equal(row?.kind, 'acquireEnhance', JSON.stringify(row));
  assert.equal(row.acquireGold, 200000000);
  // Nothing starts until the whole option (the enhancing after it too) is affordable.
  const poor = {...p, coins: row.gold - 1};
  assert.ok(!['vendorBuy', 'breedMounts'].includes(planner.plan(poor, {skill: 'melee', target: 41, budget: {coins: 0, items: {}}}, 'melee')?.intent?.t));
  p.coins = row.gold + 1e6;
  const plan = planner.plan(p, {skill: 'melee', target: 41, budget: {coins: 0, items: {}}}, 'melee');
  assert.deepEqual(plan?.intent, {t: 'vendorBuy', itemId: HORSE_ID, qty: 100}, JSON.stringify([plan?.intent, plan?.label, plan?.reason]));
  assert.equal(validateIntent(d, p, plan.intent, {planner}), true);
});

test('a held legendary mount is enhanced in the bank, then put on once it beats the worn one', () => {
  const {planner, d, p} = walker({bank: {4328: 1, [302]: 1e6}});
  const shard = {...p, bank: {...p.bank, [d.shardId]: 1e6}};
  const row = planner.investmentOptions(shard, 'melee', null).find(r => r.slot === 'mount' && r.cheapest);
  assert.equal(row?.kind, 'acquireEnhance', JSON.stringify(row));
  assert.equal(row.source, '已持有');
  const step = planEnhancement(d, planner, shard, 'melee', null);
  assert.deepEqual(step.intent, {t: 'enhance', itemId: 4328, toPlus: 1, once: true});
  // At +2 it beats the worn epic +5: the owned swap puts it on.
  const raised = {...shard, bank: {[d.shardId]: 1e6, [4328 + 2 * d.plusScale]: 1}};
  assert.equal(planner.ownedBest(raised, 'melee', null, 'mount'), 4328 + 2 * d.plusScale);
});
