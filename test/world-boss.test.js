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

// 2026-11-20: the helper never joins a Boss itself; the game joins every round
// (the Vein Blessing's auto-join) and the helper waits it out.
test('the helper never joins a Boss: working, idle next to it, or walking', () => {
  const {boss, you} = setup();
  rise(boss);
  assert.equal(boss.next({...you, route: {jobId: 1, siteId: 1}}), null, 'working: the task goes on');
  assert.equal(boss.next({...you, x: 120, y: 100}, {interruptWalk: true}), null, 'right next to it: no attack');
  assert.equal(boss.next({...you, activity: 'walking', path: [{x: 101, y: 100}]}, {interruptWalk: true}), null);
  assert.match(boss.status().policyReason, /游戏自动参加/);
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

test('the game\'s join is waited out: no leave after a hit, no takeover when it stalls, a slow resume finished', () => {
  const {boss, you, advance} = setup();
  rise(boss, 1000 + 100000);
  boss.handOff('矿脉祝福：游戏自动参加本轮世界 Boss');
  assert.equal(boss.status().phase, 'native');
  const working = {...you, route: {jobId: 7, siteId: 3}};
  assert.equal(boss.next(working)?.intent ?? null, null, 'the game has not set the work aside yet');
  const held = {...you, route: null, held: true, raidHeld: true, queue: [{kind: 'job', jobId: 7, siteId: 3}], activity: 'idle', path: null};
  advance(31000);
  assert.equal(boss.next(held, {interruptWalk: true})?.intent ?? null, null, 'a quiet join is not taken over');
  assert.equal(boss.ownsRun(), false);
  boss.observe({tick: 1003, m: [{t: 'raidHit', damage: 12}]});
  assert.equal(boss.next(held)?.intent ?? null, null, 'a hit: the round goes on to its end');
  boss.observe({tick: 1004, m: [{t: 'bossGone'}]});
  assert.match(boss.next(held).reason, /等待游戏恢复/);
  advance(9000);
  const left = {...held, raidHeld: false};
  assert.deepEqual(boss.next(left)?.intent, {t: 'startQueued', index: 0}, 'a slow resume is finished by the helper');
  assert.equal(boss.next(working), null, 'work is back: done');
  assert.equal(boss.status().phase, 'watching');
});

test('a handed-over round survives a reload', () => {
  const {boss} = setup();
  rise(boss, 1000 + 100000);
  boss.handOff();
  const again = createWorldBoss(data, () => 1_000_000);
  again.restore(boss.save());
  assert.equal(again.status().phase, 'native');
});

test('an assumed outside raid with no sign of it for 2 minutes no longer holds the character idle', () => {
  const {boss, you, advance} = setup();
  rise(boss, 1000 + 100000);
  boss.manualAction({t: 'attackWorldBoss'}, you);
  const idle = {...you, route: null, held: false, raidHeld: false, queue: [], activity: 'idle', path: null};
  assert.match(boss.next(idle).reason, /玩家正在参加/);
  advance(60000);
  assert.match(boss.next(idle).reason, /玩家正在参加/, 'one quiet minute: still waiting');
  advance(61000);
  const after = boss.next(idle, {interruptWalk: true});
  assert.ok(!after || !/玩家正在参加/.test(after.reason ?? ''), JSON.stringify(after));
  assert.notEqual(boss.status().phase, 'manual');
});

test('a start during the game\'s Boss join is not stopped by the set-aside task, which is resumed after', async () => {
  // 2026-11-21: every reconnect during a Boss stopped on "虾（已搁置）" in the queue.
  const {Trainer} = await import('../src/runtime/trainer.js');
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), sent = [];
  let clock = 1_000_000;
  const t = new Trainer(planner.data, planner, intent => sent.push(intent), () => clock);
  const queue = [{kind: 'job', jobId: 7, siteId: 3}];
  const raiding = player(planner, {x: 120, y: 100, lastTick: 1000, route: null, queue, held: true, raidHeld: true, path: null});
  Object.assign(t, {compatible: true, player: raiding});
  t.boss.observe({tick: 1000, m: [{t: 'snapshot', you: raiding}]});
  t.boss.observe({tick: 1001, m: [{t: 'bossRose', name: 'Vein colossus', x: 120, y: 100, until: 100000}]});
  assert.equal(t.boss.ownsQueue(raiding), true, 'a raid set-aside is the game\'s join');
  t.start(true);
  assert.equal(t.active, true, 'started, not blocked by the held task');
  assert.equal(t.queueBlocked, false);
  // The round ends; the game leaves the task set aside: the helper resumes it.
  t.boss.next(raiding);
  t.boss.observe({tick: 1100, m: [{t: 'bossGone'}]});
  clock += 9000;
  const left = {...raiding, raidHeld: false};
  assert.equal(t.boss.ownsQueue(left), true, 'still the handed round\'s work');
  assert.deepEqual(t.boss.next(left)?.intent, {t: 'startQueued', index: 0});
  // A task the player set aside without any Boss still stops a start.
  const fresh = new Trainer(planner.data, planner, () => {}, () => clock);
  Object.assign(fresh, {compatible: true, player: {...raiding, raidHeld: false}});
  fresh.start(true);
  assert.equal(fresh.active, false);
  assert.equal(fresh.queueBlocked, true);
});

test('the scheduler sends no Boss command when a Boss rises', async () => {
  const {Trainer} = await import('../src/runtime/trainer.js');
  const {makePlanner, player} = await import('./helpers.js');
  const planner = makePlanner(), sent = [];
  let clock = 1_000_000;
  const t = new Trainer(planner.data, planner, intent => sent.push(intent), () => clock);
  const p = player(planner, {x: 120, y: 100, lastTick: 1000, route: null, queue: [], path: null, activity: 'idle'});
  Object.assign(t, {active: true, compatible: true, player: p, received: clock, awaitInitial: false,
    snapshotSequence: 1, syncAfter: 1, nextSync: clock + 60000, nextAction: clock + 4000});
  t.boss.observe({tick: 1000, m: [{t: 'snapshot', you: p}]});
  t.boss.observe({tick: 1001, m: [{t: 'bossRose', name: 'Vein colossus', x: 120, y: 100, until: 100000}]});
  t.tick();
  assert.ok(!sent.some(i => ['attackWorldBoss', 'leaveWorldBoss', 'setAside'].includes(i.t)), JSON.stringify(sent));
});
