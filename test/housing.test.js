import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseHouseFuel, housePointsOf} from '../src/planner/housing.js';
import {saleProtectionReason} from '../src/planner/inventory.js';
import {COAL_ID, merchantPrice} from '../src/planner/items.js';
import {data} from './helpers.js';

const d = data(), R = d.rarityScale;
const id = name => Object.values(d.items).find(i => i.name === name).id;

test('house points follow the client: tier, x3 per quality, crafted depth bonus', () => {
  const copper = id('Copper');
  assert.deepEqual(housePointsOf(d, copper), {family: 'stone', each: 1});
  assert.equal(housePointsOf(d, copper + R).each, 3);
  assert.equal(housePointsOf(d, copper + 2 * R).each, 9);
  // Bronze bar = copper + tin (1 + 1 stone), one recipe deep: x1.5.
  assert.deepEqual(housePointsOf(d, id('Bronze bar')), {family: 'stone', each: 3});
  // Bronze blade = one bar, two recipes deep: (1 + 1) x 2.
  assert.equal(housePointsOf(d, id('Bronze blade')).each, 4);
  assert.equal(housePointsOf(d, id('Bronze blade') + d.plusScale), null, 'enhanced items cannot be converted');
});

test('fuel is the cheapest coins per point; common coal and legendary are never used', () => {
  const copper = id('Copper');
  const legendary = copper + (d.rarityMultipliers.length - 1) * R;
  const p = {bank: {[COAL_ID]: 5000, [COAL_ID + R]: 40, [copper]: 500, [copper + R]: 100, [legendary]: 50}, pack: []};
  const inventory = {items: [{itemId: copper, sellFromBank: 400}]};
  const fuel = chooseHouseFuel(d, {p, families: ['stone'], missing: 200, inventory, budget: {items: {}},
    unitValue: item => merchantPrice(d, item)});
  const used = fuel.conversions.map(c => c.itemId);
  assert.ok(!used.includes(COAL_ID), 'common coal is kept for smelting');
  assert.ok(!used.includes(legendary), 'legendary is the player\'s');
  assert.ok(fuel.donors.some(x => x.itemId === COAL_ID + R), 'uncommon coal is fuel');
  assert.equal(used[0], copper + R, 'uncommon copper: 3 points for the merchant price of 1');
  const order = fuel.donors.map(x => x.unit / x.each);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(fuel.remaining <= 0);
});

test('planned quality materials are kept out of the fuel', () => {
  const copper = id('Copper');
  const p = {bank: {[copper + R]: 100}, pack: []};
  const fuel = chooseHouseFuel(d, {p, families: ['stone'], missing: 1000, inventory: {items: []},
    budget: {items: {[copper + R]: 80}}, unitValue: item => merchantPrice(d, item)});
  assert.equal(fuel.donors[0].available, 20);
});

test('common coal is never sold', () => {
  assert.match(saleProtectionReason(d, COAL_ID), /煤炭/);
  assert.equal(d.jobs.filter(j => j.inputs.some(i => i.itemId === COAL_ID)).length > 0, true);
});

test('a conversion the game ignored (nothing changed) does not pause; that fuel is skipped for a while', async () => {
  const {Trainer} = await import('../src/runtime/trainer.js');
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), d = planner.data, clock = 1e9;
  const refused = [];
  planner.refuseHouseFuel = (p, itemId) => refused.push(itemId);
  const t = new Trainer(d, planner, () => {}, () => clock);
  const p = player(planner, {bank: {3: 40}, housePoints: {stone: 10}});
  Object.assign(t, {active: true, compatible: true, player: p, received: clock, snapshotSequence: 2, syncAfter: 1, nextSync: clock + 60000,
    pending: {intent: {t: 'convertHouse', itemId: 3, qty: 20}, label: '准备矿井升级 · 转换 Iron × 20', before: p, sentAt: clock - 40000},
    resolution: {sequence: 1, reason: '操作未得到确认', code: null}});
  t.tick();
  assert.equal(t.pausedError ?? null, null, 'no pause');
  assert.equal(t.active, true);
  assert.deepEqual(refused, [3]);
  assert.match(t.history[0].message, /未生效/);
  // Something did change: the old guard against spending twice still applies.
  const spent = new Trainer(d, planner, () => {}, () => clock);
  Object.assign(spent, {active: true, compatible: true, player: {...p, bank: {3: 30}}, received: clock, snapshotSequence: 2, syncAfter: 1,
    nextSync: clock + 60000, pending: {intent: {t: 'convertHouse', itemId: 3, qty: 20}, label: 'x', before: p, sentAt: clock - 40000},
    resolution: {sequence: 1, reason: '操作未得到确认', code: null}});
  spent.tick();
  assert.ok(spent.pausedError, 'a partial change still pauses');
});

test('auto-housing off: no new house work, and a visit under way leaves home', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {houseCells: [d.houseRules.entrance], houseFurniture: {}, house: {}, housePoints: {}, houseUpgrades: {},
    path: null, route: null, activity: 'idle'});
  const portal = d.houseTravel.portals[0];
  const visiting = () => planner.housingRuntime({owner: p.id, visit: {phase: 'work', portalId: portal.id, resume: null}, retryAt: 0});
  visiting();
  assert.ok(planner.housingPlan(p, {skill: 'mining'}, 'melee', 'balanced')?.intent, 'enabled: the visit carries on toward home');
  visiting();
  planner.setHousingEnabled(false);
  assert.equal(planner.housingPlan(p, {skill: 'mining'}, 'melee', 'balanced'), null, 'outside home with nothing to resume');
  assert.equal(planner.housingRuntime().visit, null, 'the visit is over');
  assert.equal(planner.housingPlan(p, {skill: 'mining'}, 'melee', 'balanced'), null, 'and no new visit starts');
});

test('house fuel and the page check use the player\'s profession for quality holds', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const {validateIntent} = await import('../src/runtime/intents.js');
  // Background planning and the page each have their own planner; neither has
  // run plan() before the house work, which used to leave magic's holds.
  for (const check of [
    (planner, p) => planner.housingPlan(p, {skill: 'mining'}, 'ranged', 'balanced'),
    (planner, p) => validateIntent(planner.data, p, {t: 'convertHouse', itemId: 3, qty: 1}, {planner, goal: {skill: 'mining'}, style: 'ranged'}),
  ]) {
    const planner = makePlanner(), d = planner.data, seen = [];
    const reserve = planner.plannedGearReserve;
    planner.plannedGearReserve = (p, profession) => {seen.push(profession);return reserve(p, profession);};
    const p = player(planner, {houseCells: [d.houseRules.entrance], houseFurniture: {}, house: {}, housePoints: {}, houseUpgrades: {},
      path: null, route: null, activity: 'idle', bank: {[3 + d.rarityScale]: 5}});
    check(planner, p);
    assert.equal(planner.styleHint, 'ranged');
    assert.ok(!seen.includes('magic'), JSON.stringify(seen));
  }
});

test('the page lets a quality conversion through on safety alone, not a second payback verdict', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const {validateIntent} = await import('../src/runtime/intents.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, region = d.houseTravel.region;
  const hide = id('Drake hide'), forge = d.houseRules.entrance;
  const home = extra => player(planner, {x: region.x + 1, y: region.y + 1, path: null, route: null, activity: 'idle',
    houseCells: [forge], houseFurniture: {forge: {cell: forge, slot: 0}}, house: {}, housePoints: {}, houseUpgrades: {},
    bank: {[hide + R]: 5, [hide + 4 * R]: 2}, ...extra});
  const goal = {skill: 'smithing'}, check = (p, intent) => validateIntent(d, p, intent, {planner, goal, style: 'melee'});
  // No gold rate on the page (no simulated rates): its own payback could not
  // be computed, yet the planner's conversion of rare hide is safe to send.
  planner.coinRate = () => 0;
  assert.equal(check(home(), {t: 'convertHouse', itemId: hide + R, qty: 5}), true);
  assert.equal(check(home(), {t: 'convertHouse', itemId: hide + R, qty: 6}), false, 'more than held');
  assert.equal(check(home(), {t: 'convertHouse', itemId: hide + 4 * R, qty: 1}), false, 'legendary is the player\'s');
  assert.equal(check(home({houseFurniture: {}}), {t: 'convertHouse', itemId: hide + R, qty: 5}), false, 'no facility takes hide points');
  assert.equal(check(home({houseUpgrades: {forge: 1e12}}), {t: 'convertHouse', itemId: hide + R, qty: 5}), false, 'already upgrading');
  assert.equal(check(home({bankLocked: [hide + R]}), {t: 'convertHouse', itemId: hide + R, qty: 5}), false, 'bank-locked');
  assert.equal(check(home({x: 0, y: 0}), {t: 'convertHouse', itemId: hide + R, qty: 5}), false, 'away from home');
});

test('a command refused before sending is not left waiting to be confirmed', async () => {
  const {Trainer} = await import('../src/runtime/trainer.js');
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), d = planner.data;
  const t = new Trainer(d, planner, () => {throw new Error('计划涉及未知或受保护物品，等待重新核对');}, () => 1e9);
  t.player = player(planner, {hp: 100});
  assert.throws(() => t.issue({intent: {t: 'convertHouse', itemId: 3, qty: 1}, label: 'x'}, true), /受保护/);
  assert.equal(t.pending, null);
});

test('room upgrades, placing and building pass the page check on what is possible, not on which room comes first', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const {validateIntent} = await import('../src/runtime/intents.js');
  const planner = makePlanner(), d = planner.data, region = d.houseTravel.region, entrance = d.houseRules.entrance;
  const cells = [entrance, entrance + 1, entrance + 2];
  const home = extra => player(planner, {x: region.x + 1, y: region.y + 1, path: null, route: null, activity: 'idle', coins: 0,
    houseCells: cells, houseFurniture: {post: {cell: entrance + 1, slot: 0}}, house: {post: 12}, housePoints: {stone: 1e9}, houseUpgrades: {},
    ...extra});
  const goal = {skill: 'melee'}, check = (p, intent) => validateIntent(d, p, intent, {planner, goal, style: 'melee'});
  planner.coinRate = () => 0; // the page's own payback cannot be computed
  assert.equal(check(home(), {t: 'upgradeRoom', room: 'post'}), true, 'points are there: the upgrade is sent');
  assert.equal(check(home({housePoints: {stone: 0}}), {t: 'upgradeRoom', room: 'post'}), false, 'not enough points');
  assert.equal(check(home({houseUpgrades: {post: 1e12}}), {t: 'upgradeRoom', room: 'post'}), false, 'already upgrading');
  assert.equal(check(home(), {t: 'upgradeRoom', room: 'forge'}), false, 'not placed');
  assert.equal(check(home({x: 0, y: 0}), {t: 'upgradeRoom', room: 'post'}), false, 'away from home');
  assert.equal(check(home(), {t: 'placeFurniture', room: 'forge', cell: entrance + 2, slot: 0}), true);
  assert.equal(check(home(), {t: 'placeFurniture', room: 'forge', cell: entrance + 1, slot: 0}), false, 'cell taken');
  assert.equal(check(home(), {t: 'placeFurniture', room: 'forge', cell: entrance, slot: 0}), false, 'the entrance');
  assert.equal(check(home(), {t: 'buildRoom', cell: entrance + 3}), false, 'no gold for it');
});

test('a house plot is bought only for a facility whose first level repays it (the shared payback)', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const make = rate => {
    const planner = makePlanner(), d = planner.data, region = d.houseTravel.region, entrance = d.houseRules.entrance;
    planner.coinRate = () => rate;
    planner.setHousingEnabled(true);
    const p = player(planner, {x: region.x + 1, y: region.y + 1, path: null, route: null, activity: 'idle', coins: 1e9,
      levels: {smithing: 50}, houseCells: [entrance, entrance + 1], houseFurniture: {post: {cell: entrance + 1, slot: 0}},
      house: {post: 1}, housePoints: {}, houseUpgrades: {}});
    return planner.housingPlan(p, {skill: 'smithing', target: 51, budget: {coins: 0, items: {}}}, 'melee', 'balanced');
  };
  assert.equal(make(1e9)?.intent?.t, 'buildRoom', 'gold is cheap against the time a forge saves');
  assert.notEqual(make(1e-6)?.intent?.t, 'buildRoom', 'gold is dear: the plot does not repay');
});

test('the lucky shrine is placed for work that rolls quality, by the gold of its rarer drops', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const plan = goal => {
    const planner = makePlanner(), d = planner.data, region = d.houseTravel.region, entrance = d.houseRules.entrance;
    planner.coinRate = () => 100;
    planner.saleValue = (_p, id) => id >= d.rarityScale ? 5e4 : 10;
    planner.setHousingEnabled(true);
    const p = player(planner, {x: region.x + 1, y: region.y + 1, path: null, route: null, activity: 'idle', coins: 0,
      levels: {mining: 50, smithing: 50}, houseCells: [entrance, entrance + 1, entrance + 2],
      houseFurniture: {mine: {cell: entrance + 1, slot: 0}, forge: {cell: entrance + 1, slot: 0}}, house: {}, housePoints: {},
      houseUpgrades: {mine: 1e12, forge: 1e12}});
    const job = skill => d.jobs.find(j => j.skill === skill && j.levelReq <= 1 && !j.grow && (skill === 'mining') === !j.inputs.length);
    return planner.housingPlan(p, {skill: goal, recipeId: job(goal).id, target: 51, budget: {coins: 0, items: {}}}, 'melee', 'balanced');
  };
  assert.deepEqual(plan('mining')?.intent, {t: 'placeFurniture', room: 'shrine', cell: 12 + 2, slot: 0});
  assert.notEqual(plan('smithing')?.intent?.room, 'shrine', 'crafting rolls no quality');
});

test('a trip home with nothing left to do is dropped before entering, and the work resumed', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {houseCells: [d.houseRules.entrance], houseFurniture: {}, house: {}, housePoints: {}, houseUpgrades: {},
    path: null, route: null, activity: 'idle', coins: 0});
  const portal = d.houseTravel.portals[0], resume = {t: 'setRoute', jobId: 1, siteId: 1, limit: 0, onFull: 'bank', rarity: 0};
  planner.housingRuntime({owner: p.id, visit: {phase: 'enter', portalId: portal.id, resume}, retryAt: 0});
  const plan = planner.housingPlan(p, {skill: 'melee', developmentFiller: true}, 'melee', 'balanced');
  assert.deepEqual(plan?.intent, resume, JSON.stringify(plan));
  assert.match(plan.reason, /取消这次回家/);
  assert.equal(planner.housingRuntime().visit, null);
});

// Live: the lectern (enhance success) sat at level 8 with stone points to spare:
// it served only plans whose cash budget carried an enhancement, which no plan
// does any more. It serves enhancing whenever the investment table has a
// worthwhile enhancement step.
test('the lectern is upgraded while an enhancement on the table is worth doing', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const plan = worth => {
    const planner = makePlanner(), d = planner.data, region = d.houseTravel.region, entrance = d.houseRules.entrance;
    planner.coinRate = () => 1;
    planner.setHousingEnabled(true);
    planner.investmentOptions = () => [{kind: 'enhance', worth, slot: 'weapon'}];
    const p = player(planner, {x: region.x + 1, y: region.y + 1, path: null, route: null, activity: 'idle', coins: 0,
      levels: {mining: 50}, houseCells: [entrance, entrance + 1], houseFurniture: {lectern: {cell: entrance + 1, slot: 0}},
      house: {lectern: 8}, housePoints: {stone: 1e9}, houseUpgrades: {}});
    return planner.housingPlan(p, {skill: 'mining', target: 51, budget: {coins: 0, items: {}}}, 'melee', 'balanced');
  };
  assert.deepEqual(plan(true)?.intent, {t: 'upgradeRoom', room: 'lectern'});
  assert.equal(plan(false)?.intent?.room, undefined, 'nothing to enhance: the lectern waits');
});

// 只收菜 upgrades the house too, beside the player's queue: their work goes to
// the front of the queue (held), the visit runs, and the queue carries on.
test('assist mode visits home beside the player\'s queue and hands it back', async () => {
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), d = planner.data, region = d.houseTravel.region, entrance = d.houseRules.entrance;
  planner.coinRate = () => 1;
  planner.setHousingEnabled(true);
  planner.taskBoundary = () => true;
  const own = {zoneId: null, siteId: 46, jobId: 45, onFull: 'bank', limit: null, phase: 'toWork'};
  const queued = {kind: 'job', siteId: 23, jobId: 8, onFull: 'bank', limit: null, rarity: 0};
  const base = {coins: 0, levels: {mining: 50}, houseCells: [entrance, entrance + 1], houseFurniture: {mine: {cell: entrance + 1, slot: 0}},
    house: {mine: 3}, housePoints: {stone: 1e9, wood: 1e9, fish: 1e9, crop: 1e9, hide: 1e9}, houseUpgrades: {}, queueSlots: 2, activity: 'idle', path: null};
  const out = player(planner, {...base, route: own, queue: [queued], held: false});
  assert.deepEqual(planner.housingPlan(out, null, 'melee', 'assist')?.intent, {t: 'setAside'}, 'the player\'s work goes to the front of the queue');
  const parked = {...out, route: null, held: true, queue: [{kind: 'job', ...own}, queued]};
  assert.equal(planner.housingPlan(parked, null, 'melee', 'assist')?.intent?.t, 'walk', 'then home, with the queue held');
  const home = {...parked, x: region.x + 1, y: region.y + 1};
  assert.deepEqual(planner.housingPlan(home, null, 'melee', 'assist')?.intent, {t: 'upgradeRoom', room: 'mine'});
  const done = {...home, houseUpgrades: {mine: 1e12}};
  assert.ok(['walk', 'portal'].includes(planner.housingPlan(done, null, 'melee', 'assist')?.intent?.t), 'then out of the house');
  assert.deepEqual(planner.housingPlan({...parked, houseUpgrades: {mine: 1e12}}, null, 'melee', 'assist')?.intent, {t: 'startQueued', index: 0}, 'outside again: the queue carries on');
  // A queue the player paused, or one with no room, is left alone.
  planner.housingRuntime({owner: out.id, visit: null, retryAt: 0});
  assert.equal(planner.housingPlan({...out, held: true}, null, 'melee', 'assist'), null);
  assert.equal(planner.housingPlan({...out, queue: [queued, queued, queued]}, null, 'melee', 'assist'), null);
});
