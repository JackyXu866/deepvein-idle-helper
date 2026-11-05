// Mastery points (client 1.0.12xx). Ranks are permanent: the server refuses
// fewer ranks than held, so a point is placed once. The work page's points go
// where the current kind of work gains most per point, measured by the rule
// that picks that work:
//  - 补精通: the gold to finish the next collection targets, in collection.js
//    order (masteryPrice: their time at the gold rate, inputs held fixed);
//  - an income goal: its gold per second (rates.goldRate);
//  - leveling: the time the measured routes take for their XP, walking
//    included, plus the gold rarer drops add, as time at the gold rate.
// Every trial allocation goes through the same formulas (house, mastery,
// quality factor), so the result is the allocation, not a guess per rank.
// The enhance page (mastery-pages.js) holds enhance ranks only.
import {GATHER_SKILLS, MASTERY_NAMES_ZH, MASTERY_RANK_LIMIT, MASTERY_TRACKS, masteryLift, rankCost, spentPoints} from '../engine/mastery-rules.js';
import {ENHANCE_PAGE, ENHANCE_RANK_CAP, WORK_PAGE, hasEnhancePage} from './mastery-pages.js';
import {combatEstimate, workEstimate} from './estimates.js';
import {combatStats, goldRate, workInputs} from './rates.js';

const CRAFT_SKILLS = ['smithing', 'cooking', 'fletching', 'herblore', 'crafting'];
// Tracks the work page buys: offline time is not time an online helper saves,
// max HP only keeps a fight safe, enhance belongs to the enhance page.
export const WORK_TRACKS = ['xp', 'gather', 'craft', 'move', 'maxhit', 'accuracy', 'rare'];
// The 补精通 targets the points are weighed on: the next ones in its order.
export const PLAN_TARGETS = 12;

// How the account spends its time, from measured routes: gathering, crafting,
// fighting and walking (bank trips). Without measurements, the current goal's
// kind of work takes all the time.
export function timeShares(data, usage, goal = null) {
  const sums = {gather: 0, craft: 0, combat: 0, walk: 0};
  for (const route of routes(data, usage)) sums[route.kind] += route.seconds;
  for (const m of Object.values(usage ?? {})) if (m?.seconds > 0) sums.walk += Math.min(m.seconds, Math.max(0, m.travelSeconds ?? 0));
  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  if (total > 0) return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / total]));
  const kind = goal?.monsterId != null ? 'combat' : GATHER_SKILLS.includes(goal?.skill) ? 'gather' :
    CRAFT_SKILLS.includes(goal?.skill) ? 'craft' : null;
  return {gather: 0, craft: 0, combat: 0, walk: 0, ...(kind ? {[kind]: 1} : {})};
}
// Measured routes with their working seconds (travel apart), and the work behind each.
function routes(data, usage) {
  const out = [];
  for (const [key, m] of Object.entries(usage ?? {})) {
    if (!(m?.seconds > 0)) continue;
    const id = Number(key.split(':')[1]), seconds = m.seconds - Math.min(m.seconds, Math.max(0, m.travelSeconds ?? 0));
    if (key.startsWith('combat:')) {
      const monster = data.monsters.find(x => x.id === id);
      if (monster && seconds > 0) out.push({kind: 'combat', monster, seconds});
      continue;
    }
    const job = data.jobs.find(j => j.id === id), kind = GATHER_SKILLS.includes(job?.skill) ? 'gather' : CRAFT_SKILLS.includes(job?.skill) ? 'craft' : null;
    if (job && !job.grow && kind && seconds > 0) out.push({kind, job, seconds});
  }
  return out;
}

// Spend `available` points from `ranks`, each step on the ranks with the most
// gained per point (value: higher is better). Max hit is weighed up to eight
// ranks at a time, since the hit rounds up only every few ranks. A best step
// not affordable yet is bought as far as the points go (those ranks lead to
// it); with not even one rank affordable, the points wait for it.
export function allocate(ranks, available, tracks, value, {lookahead = id => id === 'maxhit' ? 8 : 1, maxSteps = 600} = {}) {
  const now = {...ranks}, bought = {};
  let left = available, current = value(now), saving = null;
  for (let step = 0; step < maxSteps; step++) {
    let best = null;
    for (const id of tracks) {
      let cost = 0;
      for (let k = 1; k <= lookahead(id) && now[id] + k <= MASTERY_RANK_LIMIT; k++) {
        cost += rankCost(now[id] + k);
        const gain = value({...now, [id]: now[id] + k}) - current;
        if (Number.isFinite(gain) && gain > 1e-12 * Math.max(1, Math.abs(current)) && (!best || gain / cost > best.gain / best.cost))
          best = {id, k, cost, gain};
      }
    }
    if (!best) break;
    let n = 0;
    while (n < best.k && rankCost(now[best.id] + 1) <= left) { left -= rankCost(now[best.id] + 1); now[best.id]++; n++; }
    if (n) { bought[best.id] = (bought[best.id] ?? 0) + n; current = value(now); }
    if (n < best.k) { saving = {id: best.id, need: rankCost(now[best.id] + 1)}; break; }
  }
  return {ranks: now, bought, left, saving, value: current};
}

const gold = n => Math.round(n).toLocaleString();
export function createMasteryPlan(data, planner) {
  // What the work page's points are weighed on, for this goal.
  function objective(p, goal, style, usage) {
    const at = ranks => ({...p, masteries: ranks}), rate = planner.coinRate?.(p) ?? 0, profession = style ?? 'magic';
    if (goal?.mastery) {
      const units = new Map();
      const price = (ranks, t) => planner.masteryPrice?.(at(ranks), t, style, {rate, units}) ?? Infinity;
      const base = Object.fromEntries(MASTERY_TRACKS.map(id => [id, p.masteries?.[id] ?? 0]));
      const targets = (planner.masteryTargets?.(p, style) ?? []).filter(t => !t.forge && Number.isFinite(price(base, t))).slice(0, PLAN_TARGETS);
      if (targets.length) return {label: `按补精通：接下来 ${targets.length} 个收藏目标花的金币（时间按金币效率折算）最少`,
        value: ranks => -targets.reduce((n, t) => n + price(ranks, t), 0),
        change: (before, after) => `这些目标约 ${gold(-before)} → ${gold(-after)} 金币`};
    }
    const monster = goal?.monsterId != null ? data.monsters.find(m => m.id === goal.monsterId) : null;
    const job = !monster && goal?.recipeId != null ? data.jobs.find(j => j.id === goal.recipeId) : null;
    if (goal?.specialization && goal.rate?.coins > 0 && (monster || job)) return {label: '按主业收益：当前工作每小时金币最多',
      value: ranks => goldRate(data, planner, at(ranks), {job, monster, profession}),
      change: (before, after) => `约 ${gold(before * 3600)} → ${gold(after * 3600)} 金币/小时`};
    // Leveling: each measured route's time per XP, walking, and rarer drops as time.
    let list = routes(data, usage);
    if (!list.length && (monster || job)) list = [{kind: monster ? 'combat' : 'gather', monster, job, seconds: 1}];
    const walk = Object.values(usage ?? {}).reduce((n, m) => n + (m?.seconds > 0 ? Math.min(m.seconds, Math.max(0, m.travelSeconds ?? 0)) : 0), 0);
    const total = list.reduce((n, r) => n + r.seconds, walk);
    if (!(total > 0)) return null;
    const seconds = (ranks, r) => {
      const q = at(ranks), lv = planner.levels(q);
      const s = r.monster ? combatEstimate(data, r.monster, combatStats(data, planner, q, profession, q.equipment, lv)).seconds :
        workEstimate(data, r.job, lv[r.job.skill], workInputs(data, planner, q, r.job)).seconds;
      return s / masteryLift(ranks, 'xp');
    };
    const base = Object.fromEntries(MASTERY_TRACKS.map(id => [id, p.masteries?.[id] ?? 0]));
    const work = r => ({job: r.job, monster: r.monster, profession});
    const start = list.map(r => seconds(base, r)), startGold = list.map(r => goldRate(data, planner, at(base), work(r)));
    return {label: '按练级：实际在做的工作（按测得的时间占比，含走路）拿同样经验的用时最少；稀有掉落按金币效率折成时间',
      value: ranks => -(list.reduce((n, r, i) => n + r.seconds * seconds(ranks, r) / start[i], 0) +
        walk * masteryLift(base, 'move') / masteryLift(ranks, 'move')) / total +
        (rate > 0 ? list.reduce((n, r, i) => n + r.seconds / total * (goldRate(data, planner, at({...base, rare: ranks.rare}), work(r)) - startGold[i]) / rate, 0) : 0),
      change: (before, after) => `用时约 -${((after - before) * 100).toFixed(1)}%`};
  }

  // The purchase for this state: {intent, label, reason} or a saving, or null.
  // `earned`: the points the engine counts; `tracks`: the client's track list.
  function choose(p, goal, {earned, tracks = MASTERY_TRACKS, style = 'magic', usage = null} = {}) {
    if (!Number.isFinite(earned) || !p?.skills) return null;
    const current = Object.fromEntries(MASTERY_TRACKS.map(id => [id, Number.isInteger(p.masteries?.[id]) ? p.masteries[id] : 0]));
    let available = earned - spentPoints(current);
    // The enhance page holds enhance ranks only: every point goes there, up to the cap.
    if (hasEnhancePage(p) && (p.masteryPage ?? WORK_PAGE) === ENHANCE_PAGE) {
      let ranks = current.enhance;
      while (ranks < ENHANCE_RANK_CAP && Number.isFinite(available) && rankCost(ranks + 1) <= available) { available -= rankCost(ranks + 1); ranks++; }
      if (ranks === current.enhance) return null;
      return {intent: {t: 'masteryConfirm', ranks: Object.fromEntries(Object.entries({...current, enhance: ranks}).filter(([, n]) => n > 0))},
        label: `分配精通点数（第二页）· ${MASTERY_NAMES_ZH.enhance} +${ranks - current.enhance}`,
        reason: '第二页只点强化成功率；强化只在第二页进行，投资表按这一页的成功率估算强化花费'};
    }
    const usable = tracks.filter(id => WORK_TRACKS.includes(id));
    if (!usable.length || !(available >= Math.min(...usable.map(id => rankCost(current[id] + 1))))) return null;
    const goalOf = objective(p, goal, style, usage);
    if (!goalOf) return null;
    const result = allocate(current, available, usable, goalOf.value);
    const name = id => MASTERY_NAMES_ZH[id] ?? id;
    const changes = Object.entries(result.bought).map(([id, n]) => `${name(id)} +${n}`).join('、');
    const wait = result.saving ? `剩余 ${Math.floor(result.left)} 点攒给 ${name(result.saving.id)}（下一级需 ${result.saving.need}）` : '';
    if (!changes) return result.saving ? {intent: null, saving: result.saving, reason: `${goalOf.label}；${wait}`} : null;
    return {intent: {t: 'masteryConfirm', ranks: Object.fromEntries(Object.entries(result.ranks).filter(([, n]) => n > 0))},
      label: `分配精通点数 · ${changes}`,
      reason: `${goalOf.label}；精通加了不能退，所以每次都按整体最优分配（${goalOf.change(goalOf.value(current), result.value)}）${wait ? `；${wait}` : ''}`};
  }
  return {choose, objective};
}
