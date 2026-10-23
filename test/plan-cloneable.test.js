import test from 'node:test';
import assert from 'node:assert/strict';
import {combatSupplies, foodHealing} from '../src/planner/supplies.js';
import {combatEstimate} from '../src/planner/estimates.js';
import {makePlanner, player} from './helpers.js';

// Plans and goals travel between the Worker and the page by structured clone:
// a function anywhere in them (a food-healing helper once was) pauses the helper.
test('food healing and combat supplies can be sent to the page', () => {
  const planner = makePlanner(), d = planner.data;
  const p = player(planner, {levels: {melee: 40, defence: 40, hitpoints: 40, cooking: 40}, bank: {65: 200}, hp: 40});
  assert.doesNotThrow(() => structuredClone(foodHealing(d, planner, p, 65)));
  const monster = d.monsters.find(m => d.zones.some(z => z.monsterId === m.id));
  const estimate = combatEstimate(d, monster, {style: 'melee', level: 40, accuracy: 0, strength: 0, defence: 0, defenceLevel: 40, speed: 5});
  const supplies = combatSupplies(d, planner, p, estimate, {zone: d.zones.find(z => z.monsterId === monster.id), monster, horizon: 1800});
  assert.doesNotThrow(() => structuredClone(supplies));
});
