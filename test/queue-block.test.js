import test from 'node:test';
import assert from 'node:assert/strict';
import {Trainer} from '../src/runtime/trainer.js';
import {validateIntent} from '../src/runtime/intents.js';
import {makePlanner, player} from './helpers.js';

test('a held queue the game does not show is named, and only the player clears it', () => {
  const planner = makePlanner(), d = planner.data, sent = [];
  const job = d.jobs.find(j => j.skill === 'mining' && !j.inputs.length);
  const t = new Trainer(d, planner, intent => sent.push(intent), () => 1e9);
  t.compatible = true;
  t.player = player(planner, {queue: [{kind: 'job', jobId: job.id, siteId: 1}, {kind: 'job', jobId: job.id, siteId: 1}], held: true, route: null});
  t.start();
  assert.equal(t.active, false, 'the queue is not overridden');
  assert.equal(t.queueBlocked, true);
  assert.match(t.history[0].message, new RegExp(`${job.name}、${job.name}（已搁置`));
  assert.equal(sent.length, 0, 'nothing is cleared on its own');
  assert.equal(t.clearGameQueue(), true);
  // The game's own form: one entry per index (a bare unqueue is ignored), last
  // first; then its resume clears the held mark, which removal leaves set.
  assert.deepEqual(sent, [{t: 'unqueue', index: 1}, {t: 'unqueue', index: 0}, {t: 'skip'}, {t: 'resync'}]);
  for (const intent of sent.slice(0, 3)) assert.equal(validateIntent(d, t.player, intent), true);
  assert.equal(validateIntent(d, t.player, {t: 'unqueue'}), false);
  assert.equal(validateIntent(d, t.player, {t: 'unqueue', index: 2}), false);
  assert.equal(validateIntent(d, {...t.player, queue: []}, {t: 'unqueue', index: 0}), false);
});

test('an empty queue still marked held blocks start, and the button only resumes it', () => {
  const planner = makePlanner(), d = planner.data, sent = [];
  const t = new Trainer(d, planner, intent => sent.push(intent), () => 1e9);
  t.compatible = true;
  t.player = player(planner, {queue: [], held: true, route: null, hp: 100});
  t.start();
  assert.equal(t.active, false);
  assert.match(t.history[0].message, /仍处于搁置状态/);
  assert.equal(t.clearGameQueue(), true);
  assert.deepEqual(sent, [{t: 'skip'}, {t: 'resync'}], 'asks for the confirming state at once');
  // Scheduling starts by itself once the game confirms, through the panel's start.
  let started = 0;
  t.onStartAfterClear = () => started++;
  const snapshot = you => t.receive({tick: you.lastTick, m: [{t: 'welcome', protocol: d.protocol, you}]});
  snapshot({...t.player, lastTick: 1001});
  assert.equal(started, 0, 'still held: keep waiting');
  snapshot({...t.player, held: false, lastTick: 1002});
  assert.equal(started, 1);
  snapshot({...t.player, held: false, lastTick: 1003});
  assert.equal(started, 1, 'only once');
  sent.length = 0;
  // Never while a task runs: the game's resume would finish it.
  const running = {...t.player, route: {jobId: 1, siteId: 1}};
  assert.equal(validateIntent(d, running, {t: 'skip'}), false);
  assert.equal(validateIntent(d, {...t.player, held: false}, {t: 'skip'}), false);
});
