import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedEnhancement} from '../src/planner/investment.js';
import {PAYBACK_MARGIN, payback, secondsSaved} from '../src/planner/gold.js';
import {planEnhancement} from '../src/planner/enhancement.js';
import {makePlanner, player} from './helpers.js';

function fighter(coins = 20000) {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const find = (slot, name) => d.gear.find(g => g.slot === slot && d.items[g.itemId].name.startsWith(name)).itemId;
  const p = player(planner, {levels: {melee: 62, defence: 60, hitpoints: 62, mining: 55, smithing: 62, thieving: 50}, coins, hp: 600,
    equipment: {weapon: find('weapon', 'Cobalt blade'), helmet: find('helmet', 'Cobalt helm'), pickaxe: find('pickaxe', 'Cobalt')},
    activity: 'idle', path: null, held: false});
  return {planner, d, p};
}

test('expected enhancement cost counts the reset to +0 on failure', () => {
  const {planner, d, p} = fighter();
  const blade = p.equipment.weapon;
  const full = expectedEnhancement(d, planner, p, blade, 5).gold;
  assert.ok(Math.abs(full - 72862) < 2, `cobalt blade 0 -> +5: ${full}`);
  // Steps: 3k, 6k, 9k, 12k, 15k at 100/94/88/82/76%: well above the 45k sum.
  assert.ok(full > 45000);
  const fromTwo = expectedEnhancement(d, planner, p, blade + 2 * d.plusScale, 5).gold;
  assert.ok(Math.abs(fromTwo - (full - expectedEnhancement(d, planner, p, blade, 2).gold)) < 1e-6);
});

test('payback: gold becomes time at the gold rate; time saved over the use period', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(secondsSaved(1, 1.25, 100 * 3600), 20 * 3600); // 25% faster saves a fifth of the time
  const ok = payback({gold: 3600, coinRate: 1, before: 1, after: 1.25, useSeconds: 10 * 3600});
  near(ok.paid, 3600);
  near(ok.saved, 2 * 3600);
  assert.equal(ok.worth, true);
  const thin = payback({gold: 3600, coinRate: 1, before: 1, after: 1.25, useSeconds: 3600 * PAYBACK_MARGIN * 5 - 1});
  assert.equal(thin.worth, false, 'must beat the cost by the margin');
  assert.equal(payback({gold: 1, coinRate: 0, before: 1, after: 2, useSeconds: 3600}).worth, false, 'no gold income: unknown');
});

test('options: one cheapest worthwhile route per slot; small gains are not worth it', () => {
  const {planner, p} = fighter();
  const rows = planner.investmentOptions(p, 'melee', null);
  const weapon = rows.find(r => r.slot === 'weapon' && r.kind === 'enhance');
  assert.ok(weapon?.worth, JSON.stringify(weapon));
  assert.ok(weapon.toPlus >= 1 && weapon.toPlus <= 5);
  assert.equal(weapon.affordable, false, '20k gold does not cover it');
  // A small gain (+0.3% from a helm enhancement) is worth it only when the time
  // it saves over its use period (to the next tier, at most 30 days) repays it.
  const helmet = rows.find(r => r.slot === 'helmet');
  if (helmet) {
    assert.ok(helmet.useSeconds <= 30 * 86400);
    assert.equal(helmet.worth, helmet.saved >= helmet.paid * 1.2, JSON.stringify(helmet));
  }
  for (const slot of new Set(rows.map(r => r.slot)))
    assert.ok(rows.filter(r => r.slot === slot && r.cheapest).length <= 1);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].net >= r.net), 'best first');
});

test('funding: a worthwhile unaffordable step is funded on the best gold job, rechecked hourly until affordable', () => {
  const {planner, d, p} = fighter();
  const goal = planner.fundingGoal(p, 'melee', {}, null);
  assert.ok(goal?.funding, 'funding goal');
  assert.ok(goal.funding.gold > p.coins);
  assert.ok(goal.rate.coins > 0, 'a gold job');
  const rate = planner.incomeRows(p, 'melee').find(r => r.goldRate);
  assert.equal(goal.monsterId ?? goal.recipeId, rate.monsterId ?? rate.recipeId, 'the job that sets the gold rate the payback used');
  assert.equal(goal.funding.until - p.lastTick, Math.ceil(3600 * 1000 / d.tickMs), 'rechecked after an hour');
  assert.ok(goal.target > 99, 'ends on gold or the recheck, not on a level');
  // The recheck: still worth it and still short, so the same improvement goes on.
  const later = {...p, lastTick: goal.funding.until};
  assert.equal(planner.fundingGoal(later, 'melee', {}, null)?.funding.key, goal.funding.key);
  // Rich enough: nothing to fund.
  const rich = fighter(5_000_000);
  assert.equal(rich.planner.fundingGoal(rich.p, 'melee', {}, null), null);
});

test('enhancement runs only on the worthwhile route, up to its stopping point', () => {
  const {planner, d, p} = fighter(5_000_000);
  p.bank[d.shardId] = 10000;
  const result = planEnhancement(d, planner, p, 'melee', null);
  const rows = planner.investmentOptions(p, 'melee', null);
  const chosen = rows.find(r => r.kind === 'enhance' && r.current === result.enhancement?.itemId);
  assert.ok(chosen?.worth && chosen.cheapest, JSON.stringify(result));
  assert.notEqual(result.enhancement.slot, 'helmet');
});

test('enhancing starts mid-task: it runs beside the route, so no batch end is awaited', async () => {
  const {createEconomy} = await import('../src/economy/economy.js');
  const {planner, d, p} = fighter(5_000_000);
  p.bank[d.shardId] = 10000;
  const crop = d.jobs.find(j => j.grow);
  const site = d.sites.find(s => s.jobIds.includes(crop.id));
  const working = {...p, route: {jobId: crop.id, siteId: site.id, phase: 'working', errand: true, limit: 0}};
  const plan = createEconomy(d, planner, {}).maintenance(working, null, 'melee', 'balanced');
  assert.equal(plan?.intent?.t, 'enhance', JSON.stringify(plan));
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.kind === 'enhance' && r.cheapest && r.worth);
  assert.equal(plan.intent.itemId, row.current, 'the table\'s pick');
});

test('stopping points reach past +5 when cheap gold makes them pay (up to the game\'s +20)', () => {
  const {planner, d, p} = fighter(5_000_000_000);
  planner.coinRate = () => 1e7; // gold is nearly free: the furthest step that still adds stats wins
  const rows = planner.investmentOptions(p, 'melee', null).filter(r => r.kind === 'enhance');
  assert.ok(rows.some(r => r.toPlus > 5), JSON.stringify(rows.map(r => [r.label, r.toPlus])));
  assert.ok(rows.every(r => r.toPlus <= 20));
});

test('a copy of the worn piece at a higher +N on sale (past +5) is priced against enhancing it', () => {
  const {planner, d, p} = fighter(5_000_000);
  const copy = p.equipment.weapon + 8 * d.plusScale;
  planner.marketAsk = (_p, id) => id === copy ? 1000 : null;
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'weapon' && r.start === copy);
  assert.ok(row, 'the +8 copy has a row (bought, then perhaps enhanced further)');
  assert.equal(row.source, '市场');
  assert.equal(row.acquireGold ?? row.gold, 1000);
  assert.ok(row.worth && row.cheapest, 'at 1,000 gold it beats enhancing the worn blade');
});

test('a failed attempt does not block the piece: the table decides whether to try again', async () => {
  const {createEnhancementTraining} = await import('../src/planner/enhancement.js');
  const {planner, d, p} = fighter(5_000_000);
  let saved = null;
  const training = createEnhancementTraining(d, planner, {read: () => saved, write: v => { saved = JSON.parse(JSON.stringify(v)); }});
  const blade = p.equipment.weapon;
  training.issued(p, {t: 'enhance', itemId: blade, toPlus: 1, worn: 'weapon'});
  assert.match(training.blocked(p, blade, 'weapon'), /尚未确认/, 'an unconfirmed attempt is not sent twice');
  // The attempt failed: XP rose, the blade stayed +0.
  training.observe({...p, skills: {...p.skills, enhancing: (p.skills.enhancing ?? 0) + 100}});
  assert.equal(training.blocked(p, blade, 'weapon'), null);
  for (let i = 0; i < 6; i++) {
    training.issued(p, {t: 'enhance', itemId: blade, toPlus: 1, worn: 'weapon'});
    training.observe({...p, skills: {...p.skills, enhancing: (p.skills.enhancing ?? 0) + 200 + i}});
  }
  assert.equal(training.blocked(p, blade, 'weapon'), null, 'no five-attempt cap either');
});

test('worn legendary gear is enhanced by the same table (it stays worn; other legendary use stays blocked)', async () => {
  const {validateIntent} = await import('../src/runtime/intents.js');
  const {planner, d, p} = fighter(5_000_000);
  p.bank[d.shardId] = 10000;
  const legendary = p.equipment.weapon + 4 * d.rarityScale;
  p.equipment.weapon = legendary;
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'weapon' && r.kind === 'enhance');
  assert.ok(row, 'the worn legendary blade has an enhance row');
  assert.equal(row.current, legendary);
  assert.notEqual(validateIntent(d, p, {t: 'enhance', itemId: legendary, toPlus: row.toPlus}, {planner}), false,
    'the enhance command is not refused for being legendary');
  assert.equal(validateIntent(d, p, {t: 'marketSell', itemId: legendary, qty: 1, price: 100}, {planner}), false, 'never sold');
});
