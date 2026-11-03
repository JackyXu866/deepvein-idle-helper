import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {makePlanner, player} from './helpers.js';

// A walk the game never started (dropped as a Boss fight ended) is checked
// after 30 seconds like any command; one under way waits for the long walk.
function setup() {
  const planner = makePlanner();
  let clock = 5e9;
  const t = new Trainer(planner.data, planner, () => {}, () => clock);
  t.compatible = true; t.active = true; t.awaitInitial = false;
  t.player = {...player(planner, {route: null, path: null, activity: 'idle', held: false}), id: 1, x: 118, y: 144};
  t.received = clock; t.nextSync = Infinity; t.lastTick = 0;
  t.pending = {intent: {t: 'walk', x: 200, y: 82}, label: '前往仓库', sentAt: clock, before: t.player};
  return {t, advance: ms => { clock += ms; t.received = clock; }};
}

test('a walk that never started is checked after 30 seconds', () => {
  const {t, advance} = setup();
  advance(31000);
  t.tick();
  assert.ok(t.resolution, 'checked like any command');
});

test('a walk under way keeps the long wait', () => {
  const {t, advance} = setup();
  t.pending.moving = true;
  advance(31000);
  t.tick();
  assert.equal(t.resolution, null);
});
