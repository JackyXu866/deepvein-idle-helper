// Mastery points (client 1.0.12xx). The server refuses fewer ranks than held,
// but a reset (masteryReset) returns every point for 50,000 gold, doubling with
// each reset (resetCost). The work page's points go
// where the current kind of work gains most per point, measured by the rule
// that picks that work:
//  - 补精通: the gold to earn the points its next targets give, each trial
//    allocation taking its own cheapest targets (masteryPrice: work and bank
//    walks at the gold rate, inputs held fixed);
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
import {professionSkill} from './professions.js';

const CRAFT_SKILLS = ['smithing', 'cooking', 'fletching', 'herblore', 'crafting'];
// Tracks the work page buys: offline time is not time an online helper saves,
// max HP only keeps a fight safe, enhance belongs to the enhance page.
export const WORK_TRACKS = ['xp', 'gather', 'craft', 'move', 'maxhit', 'accuracy', 'rare'];
// 补精通: the points weighed are those of its next PLAN_TARGETS targets; the
// targets that may supply them, those up to POOL_REACH× the gold per point of
// the dearest of these (at most POOL_SIZE).
export const PLAN_TARGETS = 12, POOL_REACH = 3, POOL_SIZE = 60;
// A reset's price (client Gw): 50,000 gold x 2^(resets so far).
export const resetCost = resets => 5e4 * 2 ** Math.min(30, Math.max(0, Math.floor(resets ?? 0)));
const DAY = 86400, WEEK = 7 * DAY;

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
// It can run in slices: past `until` (clock ms) it stops with `done: false` and
// a `resume` state that a later call continues `from` (re-valued then, so a
// changed objective is followed).
export function allocate(ranks, available, tracks, value, {lookahead = id => id === 'maxhit' ? 8 : 1, maxSteps = 600, from = null, until = Infinity, clock = msNow} = {}) {
  const now = {...(from?.now ?? ranks)}, bought = {...from?.bought};
  let left = from?.left ?? available, current = value(now), saving = null;
  const first = from?.step ?? 0;
  for (let step = first; step < maxSteps; step++) {
    // At least one step per slice, so a slice always makes progress.
    if (step > first && clock() > until) return {ranks: now, bought, left, saving, value: current, done: false, resume: {now: {...now}, bought: {...bought}, left, step}};
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
  return {ranks: now, bought, left, saving, value: current, done: true};
}
const msNow = () => globalThis.performance?.now?.() ?? Date.now();

// The reset check allocates every earned point afresh: up to seconds of pricing
// in 补精通. The worker builds a new planner each run, so its progress is kept
// here, per account and kind of goal, and worked on RESET_SLICE_MS per run.
const resetMemos = new Map();
export const RESET_SLICE_MS = 150;

const gold = n => Math.round(n).toLocaleString();
export function createMasteryPlan(data, planner) {
  // What the work page's points are weighed on, for this goal.
  function objective(p, goal, style, usage) {
    const at = ranks => ({...p, masteries: ranks}), rate = planner.coinRate?.(p) ?? 0, profession = style ?? 'magic';
    if (goal?.mastery) {
      const units = new Map();
      const price = (ranks, t) => planner.masteryPrice?.(at(ranks), t, style, {rate, units}) ?? Infinity;
      // The points the next targets give now; each allocation is judged by the
      // gold to earn as many, its own cheapest targets first: rare-find can
      // bring a rarer collection (3-30× the points) into reach, speed a slower
      // one. Only targets within POOL_REACH of the dearest one taken now can
      // get there (ranks at most double a speed or the odds).
      const ranked = (planner.masteryTargets?.(p, style) ?? []).filter(t => !t.forge && t.points > 0 && Number.isFinite(t.gold));
      const head = ranked.slice(0, PLAN_TARGETS), points = head.reduce((n, t) => n + t.points, 0);
      if (head.length && points > 0) {
        const margin = Math.max(...head.map(t => t.gold / t.points));
        const pool = ranked.filter(t => t.gold / t.points <= margin * POOL_REACH).slice(0, POOL_SIZE);
        const cost = ranks => {
          const priced = pool.map(t => ({points: t.points, gold: price(ranks, t)})).filter(x => Number.isFinite(x.gold))
            .sort((a, b) => a.gold / a.points - b.gold / b.points);
          let left = points, total = 0;
          for (const x of priced) { if (left <= 0) break; const take = Math.min(1, left / x.points); total += x.gold * take; left -= x.points * take; }
          return left > 0 ? Infinity : total;
        };
        return {label: `按补精通：攒 ${points.toLocaleString()} 点精通（接下来约 ${head.length} 个收藏目标的量）花的金币最少，每种分配按它自己最便宜的目标算`,
          value: ranks => -cost(ranks),
          // A week of 补精通: the share of its spending saved, at the gold rate.
          gold: (before, after) => before < 0 && Number.isFinite(before) && Number.isFinite(after) ? (after - before) / -before * rate * WEEK : 0, horizon: '一周补精通',
          change: (before, after) => `约 ${gold(-before)} → ${gold(-after)} 金币`};
      }
    }
    const monster = goal?.monsterId != null ? data.monsters.find(m => m.id === goal.monsterId) : null;
    const job = !monster && goal?.recipeId != null ? data.jobs.find(j => j.id === goal.recipeId) : null;
    if (goal?.specialization && goal.rate?.coins > 0 && (monster || job)) return {label: '按主业收益：当前工作每小时金币最多',
      value: ranks => goldRate(data, planner, at(ranks), {job, monster, profession}),
      gold: (before, after) => (after - before) * WEEK, horizon: '一周主业',
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
      // The XP track speeds only XP that is worth something: a skill below the cap.
      const skill = r.monster ? professionSkill(profession) : r.job.skill;
      return s / (lv[skill] >= planner.maxLevel ? 1 : masteryLift(ranks, 'xp'));
    };
    const base = Object.fromEntries(MASTERY_TRACKS.map(id => [id, p.masteries?.[id] ?? 0]));
    const work = r => ({job: r.job, monster: r.monster, profession});
    const start = list.map(r => seconds(base, r)), startGold = list.map(r => goldRate(data, planner, at(base), work(r)));
    return {label: '按练级：实际在做的工作（按测得的时间占比，含走路）拿同样经验的用时最少；稀有掉落按金币效率折成时间',
      value: ranks => -(list.reduce((n, r, i) => n + r.seconds * seconds(ranks, r) / start[i], 0) +
        walk * masteryLift(base, 'move') / masteryLift(ranks, 'move')) / total +
        (rate > 0 ? list.reduce((n, r, i) => n + r.seconds / total * (goldRate(data, planner, at({...base, rare: ranks.rare}), work(r)) - startGold[i]) / rate, 0) : 0),
      // A leveling goal changes often: a day of it, as time at the gold rate.
      gold: (before, after) => (after - before) * rate * DAY, horizon: '一天练级',
      change: (before, after) => `用时约 -${((after - before) * 100).toFixed(1)}%`};
  }

  // The purchase for this state: {intent, label, reason} or a saving, or null.
  // `earned`: the points the engine counts; `tracks`: the client's track list.
  function choose(p, goal, {earned, tracks = MASTERY_TRACKS, style = 'magic', usage = null, resetSlice = RESET_SLICE_MS} = {}) {
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
    if (!usable.length) return null;
    const goalOf = objective(p, goal, style, usage);
    if (!goalOf) return null;
    // A reset worth doing is advice for the player, never done by the helper.
    const resetAdvice = resetCheck(p, goalOf, current, earned, available, usable, resetSlice);
    const advised = result => result || resetAdvice ? {intent: null, ...result, resetAdvice} : null;
    if (!(available >= Math.min(...usable.map(id => rankCost(current[id] + 1))))) return advised(null);
    const result = allocate(current, available, usable, goalOf.value);
    const name = id => MASTERY_NAMES_ZH[id] ?? id;
    const changes = Object.entries(result.bought).map(([id, n]) => `${name(id)} +${n}`).join('、');
    const wait = result.saving ? `剩余 ${Math.floor(result.left)} 点攒给 ${name(result.saving.id)}（下一级需 ${result.saving.need}）` : '';
    if (!changes) return advised(result.saving ? {intent: null, saving: result.saving, reason: `${goalOf.label}；${wait}`} : null);
    return advised({intent: {t: 'masteryConfirm', ranks: Object.fromEntries(Object.entries(result.ranks).filter(([, n]) => n > 0))},
      label: `分配精通点数 · ${changes}`,
      reason: `${goalOf.label}；按整体最优分配（${goalOf.change(goalOf.value(current), result.value)}）${wait ? `；${wait}` : ''}`});
  }
  // A reset is worth it when allocating every earned point afresh earns, over
  // the goal's horizon (a week for 补精通 or a main trade, a day for a leveling
  // goal), at least 1.2x its price (the payback rule) more than the present
  // ranks with the free points added. Only advised: the player resets. Weighed
  // once an hour per account and kind of goal (resetMemos), a slice per run.
  function resetCheck(p, goalOf, current, earned, available, tracks, slice) {
    if (!goalOf.gold || !tracks.some(id => current[id] > 0)) return null;
    const hour = Math.floor((p.lastTick ?? 0) * data.tickMs / 3600000);
    const key = `${p.id}|${goalOf.horizon}`, stamp = JSON.stringify([hour, Math.floor(earned / 50), p.masteryResets ?? 0, tracks]);
    let memo = resetMemos.get(key);
    if (memo?.stamp !== stamp) resetMemos.set(key, memo = {stamp, fresh: null, advice: undefined});
    if (memo.advice !== undefined) return memo.advice;
    const blank = Object.fromEntries(MASTERY_TRACKS.map(id => [id, 0]));
    memo.fresh = allocate(blank, earned, tracks, goalOf.value, {from: memo.fresh?.resume, until: msNow() + slice});
    if (!memo.fresh.done) return null;
    const fresh = memo.fresh, kept = allocate(current, available, tracks, goalOf.value);
    const cost = resetCost(p.masteryResets), gain = goalOf.gold(kept.value, fresh.value);
    memo.advice = null;
    if (!(gain >= 1.2 * cost)) return null;
    const name = id => MASTERY_NAMES_ZH[id] ?? id;
    const plan = Object.entries(fresh.ranks).filter(([, n]) => n > 0).map(([id, n]) => `${name(id)} ${n}`).join('、');
    return memo.advice = {cost, gain, ranks: fresh.ranks,
      reason: `建议重置精通（${cost.toLocaleString()} 金币）：${goalOf.label}；全部 ${Math.floor(earned).toLocaleString()} 点从头分配（${plan}）比现在多赚约 ${gold(gain)} 金币（按${goalOf.horizon}算），超过重置费 1.2 倍。需要你在游戏里手动重置，之后助手按新分配加点`};
  }
  return {choose, objective};
}
