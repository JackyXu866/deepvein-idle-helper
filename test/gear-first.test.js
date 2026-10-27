import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// Planned gear is the investment table's 自制 picks: those pieces are made
// by the one gear project step, and only their quality materials are held.
// Usage: the account fights, mines, smiths and crafts (measured time), so
// every slot's piece saves time.
function uses(planner) {
  const d = planner.data, job = skill => d.jobs.find(j => j.skill === skill && j.inputs.length === (skill === 'mining' ? 0 : j.inputs.length)).id;
  planner.perkUsage = {'combat:1': {seconds: 3600}, [`job:${job('mining')}`]: {seconds: 3600},
    [`job:${job('smithing')}`]: {seconds: 3600}, [`job:${job('crafting')}`]: {seconds: 3600}};
}
function setup(bank, levels = {}) {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  uses(planner);
  const blade = n => d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name === `${n} blade`).itemId;
  const bar = d.jobs.find(j => j.output.itemId === blade('Cobalt')).inputs[0].itemId;
  const barJob = d.jobs.find(j => j.output.itemId === bar);
  const ore = barJob.inputs.find(i => d.items[i.itemId].name === 'Cobalt').itemId;
  const at = d.banks[0];
  const p = player(planner, {levels: {melee: 70, defence: 60, hitpoints: 60, smithing: 62, mining: 60, ...levels}, x: at.x, y: at.y,
    equipment: {weapon: blade('Steel') + 3 * R}, bank: bank({bar, ore, R}), coins: 0, hp: 600,
    activity: 'idle', path: null, held: false, route: null});
  const goal = {skill: 'smithing', target: 65, development: true, growth: true, recipeId: barJob.id, recipes: {smithing: barJob.id},
    budget: {coins: 0, items: {}}};
  return {planner, d, p, goal, R, blade, bar, ore, barJob};
}
const picks = (planner, p, goal) => planner.investmentOptions(p, 'melee', goal).filter(r => r.cheapest && r.source === '自制');

test('the planned piece is the table\'s 自制 pick, made first from its own materials', () => {
  const {planner, d, p, goal, R, blade, barJob} = setup(({bar, ore, R}) => ({[bar + 2 * R]: 1, [ore]: 50, 5: 500}));
  planner.perkUsage = {'combat:1': {seconds: 3600}, [`job:${barJob.id}`]: {seconds: 3600}}; // fights and smiths, never mines
  void d;
  const pick = picks(planner, p, goal).find(r => r.slot === 'weapon');
  assert.equal(pick?.id, blade('Cobalt') + 2 * R, 'a rare cobalt blade from the rare bar held');
  assert.deepEqual(planner.plannedQualityGear(p, 'melee', goal), picks(planner, p, goal).map(r => r.id).filter(id => id >= R));
  // The rare bar is held for the blade, not training stock.
  assert.equal(planner.plannedGearReserve(p, 'melee', null, goal)[d.jobs.find(j => j.output.itemId === blade('Cobalt')).inputs[0].itemId + 2 * R], 1);
  // The plan works on a picked piece (the largest net saving first: here the empty shield slot).
  const plan = planner.plan(p, goal, 'melee');
  assert.match(plan.reason, /装备项目/);
  assert.ok(picks(planner, p, goal).some(r => plan.reason.includes(d.items[r.id % R].name)), plan.reason);
});

test('the quality bars several picked pieces share are made in one batch, then the pieces', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  uses(planner);
  const id = name => Object.values(d.items).find(i => i.name === name).id;
  const bar = id('Cobalt bar'), at = d.banks[0];
  const p = player(planner, {levels: {crafting: 72, smithing: 70, mining: 70, melee: 60, defence: 60, hitpoints: 60}, x: at.x, y: at.y,
    bank: {[bar + R]: 1, [id('Cobalt') + R]: 30, [id('Cobalt')]: 200, 5: 2000}, coins: 0, hp: 600, activity: 'idle', path: null, held: false, route: null});
  const mortar = d.jobs.find(j => j.skill === 'crafting' && j.name === 'Cobalt mortar');
  const goal = {skill: 'crafting', target: 75, development: true, growth: true, recipeId: mortar.id, recipes: {crafting: mortar.id}, budget: {coins: 0, items: {}}};
  const planned = picks(planner, p, goal).filter(r => r.id >= R && d.jobs.find(j => j.output.itemId === r.id % R)?.inputs.some(i => i.itemId === bar));
  assert.ok(planned.length >= 2, `several picked pieces use uncommon cobalt bars: ${planned.map(r => r.label)}`);
  // Play the plan forward, applying each craft and equip it asks for.
  let state = p;
  const barJob = d.jobs.find(j => j.output.itemId === bar), smelts = [], made = [];
  for (let step = 0; step < 20; step++) {
    const it = planner.plan(state, goal, 'melee').intent;
    if (it?.t === 'equipFromBank') {
      const g = d.gear.find(x => x.itemId === it.itemId % d.plusScale % R);
      state = {...state, equipment: {...state.equipment, [g.slot]: it.itemId}, bank: {...state.bank, [it.itemId]: state.bank[it.itemId] - 1}};
      continue;
    }
    if (it?.t !== 'setRoute' || !it.rarity) break;
    const job = d.jobs.find(j => j.id === it.jobId), n = it.limit, bank = {...state.bank};
    for (const i of job.inputs) { const q = i.itemId === 5 ? 5 : i.itemId + it.rarity * R; bank[q] = (bank[q] ?? 0) - i.qty * n; }
    const out = job.output.itemId + it.rarity * R;
    bank[out] = (bank[out] ?? 0) + n;
    if (job.id === barJob.id) smelts.push(n); else made.push(job.name);
    state = {...state, bank};
  }
  const need = planned.reduce((n, r) => n + (d.jobs.find(j => j.output.itemId === r.id % R).inputs.find(i => i.itemId === bar)?.qty ?? 0), 0);
  assert.ok(smelts[0] >= Math.min(need - 1, 30 / d.jobs.find(j => j.output.itemId === bar).inputs.find(i => i.itemId === id('Cobalt')).qty) - 1e-9,
    `the shared bars come in one batch first: ${smelts} for ${need}`);
  assert.ok(made.length >= 1, `then the pieces: ${made}`);
});

test('held materials are those of the planned pieces, shared, never more than owned', () => {
  const {planner, p, goal, R, bar, ore} = setup(({bar, ore, R}) => ({[bar + 2 * R]: 1, [ore + 2 * R]: 40, [ore]: 50, 5: 500}));
  const reserve = planner.plannedGearReserve(p, 'melee', null, goal);
  assert.ok(planner.plannedQualityGear(p, 'melee', goal).length > 0);
  assert.ok((reserve[bar + 2 * R] ?? 0) <= 1, 'the one rare bar goes to one piece');
  assert.ok((reserve[ore + 2 * R] ?? 0) <= 40, 'never more ore than owned');
});

test('the planned quality follows the table: epic ore makes the epic blade; nothing is held for a piece not yet makeable', () => {
  const ores = ({ore, R}) => ({[ore + 2 * R]: 40, [ore + 3 * R]: 40, [ore]: 50, 5: 500});
  const now = setup(ores);
  assert.ok(now.planner.plannedQualityGear(now.p, 'melee', now.goal).includes(now.blade('Cobalt') + 3 * now.R), 'epic ore: the epic blade');
  const later = setup(ores, {smithing: 50});
  assert.deepEqual(later.planner.plannedQualityGear(later.p, 'melee', later.goal), [], 'smithing 50 cannot make it: no pick, nothing held');
  assert.deepEqual(later.planner.plannedGearReserve(later.p, 'melee', null, later.goal), {});
});

test('held materials are not training stock', () => {
  const {planner, p, goal, R, ore, barJob} = setup(({ore, R}) => ({[ore + 2 * R]: 40, [ore]: 50, 5: 500}));
  const reserve = planner.plannedGearReserve(p, 'melee', null, goal);
  const held = reserve[ore + 2 * R] ?? 0, needPerBar = barJob.inputs.find(i => i.itemId === ore).qty;
  assert.ok(planner.crafting.available(p, barJob, 2, reserve, 5000) <= Math.floor((40 - held) / needPerBar));
});
