import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// Wearing a rare Steel shield +5, with a legendary and nine uncommon Cobalt
// shields in the bank (melee 65 wears Cobalt, level 60).
function warrior() {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale, P = d.plusScale;
  const steel = 117, cobalt = 118, blade = 113;
  const p = player(planner, {levels: {melee: 65, defence: 55, hitpoints: 55, mining: 60, smithing: 60}, coins: 1e6, hp: 100,
    equipment: {weapon: blade + 3 * R, shield: steel + 2 * R + 5 * P}, bank: {[cobalt + 4 * R]: 1, [cobalt + R]: 9}});
  return {planner, d, p, R, cobalt};
}

test('the investment table offers the owned legendary shield first, and nothing worse to buy or make', () => {
  const {planner, p, R, cobalt} = warrior();
  const rows = planner.investmentOptions(p, 'melee').filter(r => r.slot === 'shield');
  const owned = rows.find(r => r.kind === 'owned');
  assert.equal(owned?.id, cobalt + 4 * R, JSON.stringify(rows.map(r => [r.kind, r.id, r.source])));
  assert.equal(owned.gold, 0);
  assert.equal(owned.source, '已持有');
  assert.ok(!rows.some(r => r.kind !== 'owned' && r.id % R === cobalt && r.id < cobalt + 4 * R),
    'no common to epic Cobalt shield is proposed while a legendary one is owned');
});

test('the planned gear for the shield slot is the owned legendary piece', () => {
  const {planner, p, R, cobalt} = warrior();
  const shield = planner.gearTargets(p, 'melee').find(t => t.slot === 'shield');
  assert.equal(shield.upgrade, cobalt + 4 * R);
});
