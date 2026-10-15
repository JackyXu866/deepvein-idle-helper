import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

const blade = (d, metal) => d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name === `${metal} blade`).itemId;

test('an epic steel blade skips ordinary cobalt and says which cobalt rarity would be an upgrade', () => {
  const planner = makePlanner(), d = planner.data;
  const steel = blade(d, 'Steel'), cobalt = blade(d, 'Cobalt'), meteoric = blade(d, 'Meteoric');
  const epicSteel = steel + 3 * d.rarityScale;
  const p = player(planner, {levels: {melee: 70, smithing: 71, mining: 70}, equipment: {weapon: epicSteel}});
  const weapon = planner.equipmentStatus(p, 'melee').find(s => s.slot === 'weapon');
  assert.equal(weapon.current.name, '史诗 Steel blade', 'quality is shown');
  const skip = weapon.skipped.find(k => k.id === cobalt);
  assert.ok(skip, JSON.stringify(weapon.skipped));
  assert.equal(skip.rarity, 2, 'rare cobalt beats epic steel; uncommon does not');
  assert.equal(weapon.next.id, meteoric);
  assert.deepEqual(Object.keys(weapon.next.materials).map(Number), d.jobs.find(j => j.output.itemId === meteoric).inputs.map(i => i.itemId),
    'own recipe only');
  assert.ok(weapon.next.requirements.some(r => r.skill === 'smithing' && r.target === 85));
  const own = Object.values(weapon.next.materials).reduce((a, b) => a + b, 0);
  const chain = Object.values(weapon.next.chainMaterials).reduce((a, b) => a + b, 0);
  assert.ok(chain > own, 'training to the unlock is shown separately and is far larger');
});

test('an ordinary steel blade still lists cobalt as the next tier', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {melee: 50, smithing: 71}, equipment: {weapon: blade(d, 'Steel')}});
  const weapon = planner.equipmentStatus(p, 'melee').find(s => s.slot === 'weapon');
  assert.equal(weapon.current.name, 'Steel blade');
  assert.equal(weapon.next.id, blade(d, 'Cobalt'));
  assert.equal(weapon.skipped.length, 0);
});
