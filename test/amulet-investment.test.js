import test from 'node:test';
import assert from 'node:assert/strict';
import {luckGold} from '../src/planner/rates.js';
import {makePlanner, player} from './helpers.js';

// An amulet's luck brings rarer drops in all the account's work; the table
// used to rate it by combat XP alone, so it never showed a gain. A miner who
// measured only mining, with rare ore selling well, and a better amulet on sale.
function miner(planner, amulet) {
  const d = planner.data, R = d.rarityScale;
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length && j.output.itemId !== d.coinId && j.levelReq <= 60);
  const ore = job.output.itemId, prices = [10, 200, 2000, 20000, 1e6];
  planner.marketUnitValue = (_p, id) => planner.base(id) === ore ? prices[Math.floor((id % d.plusScale) / R)] ?? 0 : 0;
  planner.perkUsage = {[`job:${job.id}`]: {seconds: 3600}};
  planner.coinRate = () => 50;
  const p = player(planner, {levels: {mining: 70, melee: 60, hitpoints: 60, defence: 60}, equipment: {amulet}});
  return {p, job};
}

test('an amulet is worth the rarer drops its luck brings, in the work the account does', () => {
  const planner = makePlanner(), d = planner.data;
  const {p, job} = miner(planner, 184);
  const rate = id => planner.gearRate(p, 'melee', null, 'amulet', id);
  assert.ok(rate(185) > rate(184), `${rate(185)} vs ${rate(184)}`);
  // Mining only: the index is 1 + the luck's gold at the gold rate.
  const gold = luckGold(d, planner, {...p, equipment: {...p.equipment, amulet: 185}}, {job});
  assert.ok(gold > 0);
  assert.ok(Math.abs(rate(185) - (1 + gold / 50)) < 1e-9, `${rate(185)} vs ${1 + gold / 50}`);
  planner.marketAsk = (_p, id) => id === 185 ? 1000 : null;
  const row = planner.investmentOptions(p, 'melee', null).find(r => r.slot === 'amulet' && r.id === 185);
  assert.ok(row && row.gain > 0 && row.saved > 0, JSON.stringify(row));
  assert.equal(row.worth, true, 'cheap luck pays back');
  // The luck's extra gold counts in full over the use, not as a speed ratio.
  const worn = luckGold(d, planner, p, {job});
  assert.ok(Math.abs(row.saved - (gold - worn) * row.useSeconds / 50) < 1e-3, `${row.saved} vs ${(gold - worn) * row.useSeconds / 50}`);
});

// A mount speeds every walk (bank trips, travel between sites): it is rated by
// the measured share of time spent walking, at its stride against the worn one.
test('a mount is worth the walking it saves, by the measured walking share', () => {
  const rows = walking => {
    const planner = makePlanner();
    planner.coinRate = () => 1000;
    planner.perkUsage = {'job:45': {seconds: 3600, travelSeconds: walking * 3600}};
    const p = player(planner, {levels: {enhancing: 47, smithing: 87}, coins: 1e9, equipment: {mount: 53328}});
    return planner.investmentOptions(p, 'melee', null).filter(r => r.slot === 'mount');
  };
  const walk = rows(.25).find(r => r.kind === 'enhance');
  assert.ok(walk && walk.gain > 0, 'enhancing the mount speeds the walking quarter of the time');
  assert.ok(!rows(0).some(r => r.gain > 0), 'no walking: a faster mount saves nothing');
});
