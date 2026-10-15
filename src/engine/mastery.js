import {simulate} from './runtime.js';
import {MASTERY_NAMES_ZH, MASTERY_RANK_LIMIT, MASTERY_TRACKS, rankCost, spentPoints} from './mastery-rules.js';

// Points are earned from collections and forge logs, computed by the engine itself.
// Ranks of one track affordable with `points` on top of `from`.
function affordable(from, points) {
  let n = 0, cost = 0;
  while (from + n < MASTERY_RANK_LIMIT && cost + rankCost(from + n + 1) <= points) cost += rankCost(from + ++n);
  return {ranks: n, cost};
}

// Spend unspent mastery points on the tracks with the best simulated gain per
// point for the current activity. Offline hours never help an online helper.
export function chooseMastery(api, p, goal, {metric = 'xp', budgetMs = 300, clock = () => performance.now()} = {}) {
  if (typeof api?.masteryEarnedPoints !== 'function' || !Array.isArray(api.masteryTracks) || !p?.skills) return null;
  const tracks = api.masteryTracks.map(t => t.id).filter(id => MASTERY_TRACKS.includes(id) && id !== 'offline');
  const current = Object.fromEntries(MASTERY_TRACKS.map(id => [id, Number.isInteger(p.masteries?.[id]) ? p.masteries[id] : 0]));
  const earned = api.masteryEarnedPoints(p);
  let available = earned - spentPoints(current);
  if (!Number.isFinite(available) || available < Math.min(...tracks.map(id => rankCost(current[id] + 1)))) return null;
  const activity = goal?.monsterId != null ? {monsterId: goal.monsterId} :
    goal?.recipeId != null && goal.skill ? {jobId: goal.recipeId, skill: goal.skill, inputs: goal.inputs ?? []} : null;
  if (!activity) return null;
  const began = clock();
  const rate = masteries => {
    const r = simulate(api, {...p, masteries}, activity, {hours: .5, seed: 1, maxMs: 100, clock});
    if (!r || r.failed || !(r.seconds > 0)) return null;
    return (metric === 'coins' ? r.coins : r.xp) / r.seconds;
  };
  const ranks = {...current};
  let base = rate(ranks);
  if (!(base > 0)) return null;
  const bought = {};
  while (clock() - began < budgetMs) {
    // Evaluate each track with a chunk worth up to a quarter of the points left.
    let best = null;
    for (const id of tracks) {
      const chunk = affordable(ranks[id], Math.max(rankCost(ranks[id] + 1), available / 4));
      if (!chunk.ranks || chunk.cost > available) continue;
      const after = rate({...ranks, [id]: ranks[id] + chunk.ranks});
      const value = after == null ? 0 : (after - base) / base / chunk.cost;
      if (!best || value > best.value) best = {id, ...chunk, value, after};
    }
    if (!best) break;
    // No measurable gain: XP gain helps every skill, so it is the safe default.
    if (!(best.value > 0)) {
      const chunk = affordable(ranks.xp, available);
      if (!chunk.ranks) break;
      ranks.xp += chunk.ranks; available -= chunk.cost; bought.xp = (bought.xp ?? 0) + chunk.ranks;
      break;
    }
    ranks[best.id] += best.ranks; available -= best.cost; base = best.after;
    bought[best.id] = (bought[best.id] ?? 0) + best.ranks;
  }
  if (!Object.keys(bought).length) return null;
  const changes = Object.entries(bought).map(([id, n]) => `${MASTERY_NAMES_ZH[id] ?? api.masteryTracks.find(t => t.id === id)?.name ?? id} +${n}`).join('、');
  return {intent: {t: 'masteryConfirm', ranks: Object.fromEntries(Object.entries(ranks).filter(([, n]) => n > 0))},
    label: `分配精通点数 · ${changes}`,
    reason: `可用 ${Math.floor(earned - spentPoints(current))} 点；按当前工作的引擎模拟选择每点收益最高的精通，剩余 ${Math.floor(available)} 点`};
}
