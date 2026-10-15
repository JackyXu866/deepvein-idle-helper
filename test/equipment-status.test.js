import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

const blade = (d, metal) => d.gear.find(g => g.slot === 'weapon' && d.items[g.itemId].name === `${metal} blade`).itemId;

test('with an epic steel blade, the upgrade wearable now is a rare cobalt blade; meteoric comes at the next requirement', () => {
  const planner = makePlanner(), d = planner.data;
  const steel = blade(d, 'Steel'), cobalt = blade(d, 'Cobalt'), meteoric = blade(d, 'Meteoric');
  const epicSteel = steel + 3 * d.rarityScale, rareCobalt = cobalt + 2 * d.rarityScale;
  const p = player(planner, {levels: {melee: 70, smithing: 71, mining: 70}, equipment: {weapon: epicSteel}});
  const weapon = planner.equipmentStatus(p, 'melee').find(s => s.slot === 'weapon');
  assert.equal(weapon.current.name, '史诗 Steel blade', 'quality is shown');
  assert.equal(weapon.upgrade.id, rareCobalt, 'the lowest cobalt quality that beats epic steel, wearable at 60');
  assert.equal(weapon.upgrade.name, '稀有 Cobalt blade');
  const rareBar = d.jobs.find(j => j.output.itemId === cobalt).inputs[0].itemId + 2 * d.rarityScale;
  assert.deepEqual(Object.keys(weapon.upgrade.materials).map(Number), [rareBar], 'made from rare cobalt bars');
  assert.equal(weapon.next.id, meteoric, 'ordinary meteoric already beats it at melee 75');
  assert.ok(weapon.next.requirements.some(r => r.skill === 'smithing' && r.target === 85));
  const own = Object.values(weapon.next.materials).reduce((a, b) => a + b, 0);
  const chain = Object.values(weapon.next.chainMaterials).reduce((a, b) => a + b, 0);
  assert.ok(chain > own, 'training to the unlock is shown separately and is far larger');
});

test('an ordinary steel blade: ordinary cobalt is the next tier, no rarity needed', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {melee: 50, smithing: 71}, equipment: {weapon: blade(d, 'Steel')}});
  const weapon = planner.equipmentStatus(p, 'melee').find(s => s.slot === 'weapon');
  assert.equal(weapon.current.name, 'Steel blade');
  assert.equal(weapon.next.id, blade(d, 'Cobalt'));
});
