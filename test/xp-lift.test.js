import test from 'node:test';
import assert from 'node:assert/strict';
import {xpLift, workInputs, formulaWork} from '../src/planner/rates.js';
import {makePlanner, player} from './helpers.js';

// 2026-11-10: every rate learnt from the game was about 1.5x the formula. The
// formula left out the game's XP multiplier (client JX/fm): with 62 ranks of
// XP gain, the guild's 15%, the blessing and the gatherer's brew, yew gave
// about 115,000 XP a working hour against a formula of 72,000.
test('the formula counts the game\'s XP multiplier', () => {
  const planner = makePlanner(), d = planner.data;
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const bare = player(planner, {lastTick: 1000});
  close(xpLift(d, bare, 'woodcutting', {work: true, gathering: true}), 1);
  const p = player(planner, {lastTick: 1000, masteries: {xp: 62}, guildBonus: .15, brews: {blessing: 2000, gatherer: 2000}, brewTier: {gatherer: 0}});
  close(xpLift(d, p, 'smithing', {work: true}), 1.31 * 1.15 * 1.05);
  close(xpLift(d, p, 'woodcutting', {work: true, gathering: true}), 1.31 * 1.15 * 1.05 * 1.1);
  close(xpLift(d, {...p, brews: {gatherer: 500}}, 'woodcutting', {work: true, gathering: true}), 1.31 * 1.15, 'expired brews count nothing');
  // A boss set: +2% a piece for its skills, +2% more for all three.
  const colony = {...bare, equipment: {helmet: 747, body: 748, legs: 749}};
  close(xpLift(d, colony, 'woodcutting', {work: true, gathering: true}), 1.08);
  close(xpLift(d, {...colony, equipment: {helmet: 747}}, 'fletching', {work: true}), 1.02);
  close(xpLift(d, colony, 'mining', {work: true, gathering: true}), 1, 'another set\'s skill');
  close(xpLift(d, colony, 'melee'), 1, 'not in combat');
  // The work estimate's XP carries it.
  const job = d.jobs.find(j => j.id === 34); // yew
  const skilled = q => ({...q, skills: {...q.skills, woodcutting: planner.thresholds[82]}});
  assert.equal(workInputs(d, planner, p, job).xpLift, xpLift(d, p, 'woodcutting', {work: true, gathering: true}));
  const lifted = formulaWork(d, planner, skilled(p), job).xp, plain = formulaWork(d, planner, skilled(bare), job).xp;
  // Per-action XP is rounded, and the blessing also shifts the quality odds.
  assert.ok(Math.abs(lifted / plain / (1.31 * 1.15 * 1.05 * 1.1) - 1) < .02, `${lifted / plain}`);
});
