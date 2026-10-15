import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldBoss} from '../src/runtime/world-boss.js';

const data = {tickMs: 600};
function setup() {
  let clock = 1_000_000;
  const boss = createWorldBoss(data, () => clock);
  const you = {id: 1, x: 100, y: 100, lastTick: 1000, route: null, queue: [], pack: [], bank: {}};
  boss.observe({tick: 1000, m: [{t: 'snapshot', you}]});
  return {boss, you, advance: ms => { clock += ms; }};
}
const rise = (boss, until = 1000 + 1000) => boss.observe({tick: 1001, m: [{t: 'bossRose', name: 'Vein colossus', x: 120, y: 100, until}]});

test('working on a route: Boss parks the task immediately (setAside)', () => {
  const {boss, you} = setup();
  rise(boss);
  const plan = boss.next({...you, route: {jobId: 1, siteId: 1}});
  assert.equal(plan.intent.t, 'setAside');
});

test("the helper's own walk is interrupted for a Boss", () => {
  const {boss, you} = setup();
  rise(boss);
  const walking = {...you, activity: 'walking', path: [{x: 101, y: 100}]};
  assert.equal(boss.next(walking), null, 'default: walking is not interrupted (assist mode)');
  const plan = boss.next(walking, {interruptWalk: true});
  assert.deepEqual(plan.intent, {t: 'walk', x: 120, y: 100});
});

test('a player queue is still never overridden', () => {
  const {boss, you} = setup();
  rise(boss);
  assert.equal(boss.next({...you, queue: [{kind: 'quest'}]}, {interruptWalk: true}), null);
});

test('bossNext is exposed as seconds until the next spawn', () => {
  const {boss} = setup();
  boss.observe({tick: 1002, m: [{t: 'bossNext', tick: 1002 + 500}]});
  assert.ok(Math.abs(boss.status().nextIn - 300) < 1, `${boss.status().nextIn}`);
  boss.observe({tick: 1600, m: []});
  assert.equal(boss.status().nextIn, null, 'past spawns report null');
});
