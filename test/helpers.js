// Shared fixtures for planner tests.
import fs from 'node:fs';
import {createPlanner} from '../src/planner/planner.js';

export const GAME_DATA = JSON.parse(fs.readFileSync(new URL('../src/data/game-data.json', import.meta.url), 'utf8'));
export const data = () => structuredClone(GAME_DATA);

// XP needed to reach a level, using the planner's own curve.
export function xpFor(planner, level) {
  return planner.thresholds[level] ?? 0;
}

// Minimal player snapshot shaped like the server's `you` object.
export function player(planner, {levels = {}, coins = 0, ...rest} = {}) {
  const d = planner.data ?? GAME_DATA;
  const skills = Object.fromEntries(d.skills.map(s => [s, xpFor(planner, levels[s] ?? 1)]));
  return {
    id: 1, x: 200, y: 82, lastTick: 1000, coins, skills,
    equipment: {}, bank: {}, pack: [], overflow: {}, house: {}, houseFurniture: {}, masteries: {}, perks: {},
    quests: {day: 0, week: 0, daily: [], weekly: []}, questPoints: 0, brews: {}, brewTier: {},
    route: null, queue: [], plots: {}, ...rest,
  };
}

export function makePlanner() {
  const d = data();
  const planner = createPlanner(d);
  planner.data ??= d;
  return planner;
}

// Collections for a test that looks at a few of them: every other collection
// (each quality) counts as finished, since unstarted ones are targets too.
export function onlyCollections(d, given) {
  const done = {}, bases = new Set();
  for (const j of d.jobs) { bases.add(j.output.itemId); if (j.bonus) bases.add(j.bonus.itemId); }
  for (const m of d.monsters) { bases.add(m.drop); if (m.bonus) bases.add(m.bonus.itemId); }
  for (const b of bases) for (let r = 0; r < 5; r++) done[b + r * d.rarityScale] = 1e7;
  return {...done, ...given};
}
