import {MASTERY_TRACKS, spentPoints} from '../engine/mastery-rules.js';

const MODE_LAYERS = {balanced: '自主发展计划', experience: '经验优先', business: '主业经营', assist: '只收菜＋蹭世界 Boss'};
const BOSS_PHASES = new Set(['ready', 'saving', 'moving', 'attacking', 'fighting', 'dead', 'ended', 'resuming']);

const keyOf = c => c.monsterId != null ? `combat:${c.monsterId}` : `job:${c.recipeId}`;

// Best XP/hour for each gold/hour floor: the Pareto frontier of the
// candidates, as a short list of suggestions (at most `limit`, spread out).
export function profitFrontier(rows, limit = 5) {
  const sorted = rows.filter(r => r.xpH > 0).sort((a, b) => b.coinsH - a.coinsH || b.xpH - a.xpH);
  const frontier = [];
  let bestXp = -1;
  for (const r of sorted) if (r.xpH > bestXp) { frontier.push(r); bestXp = r.xpH; }
  frontier.reverse(); // ascending gold: [max XP first ... most gold last]
  const maxXp = frontier[0]?.xpH ?? 0;
  const points = frontier.map((r, i) => ({floor: i === 0 ? 0 : Math.max(0, Math.floor(r.coinsH / 100) * 100),
    label: r.label, xpH: r.xpH, coinsH: r.coinsH, loss: maxXp > 0 ? 1 - r.xpH / maxXp : 0}));
  if (points.length <= limit) return points;
  const picked = [points[0]];
  for (let i = 1; i < limit - 1; i++) picked.push(points[Math.round(i * (points.length - 1) / (limit - 1))]);
  picked.push(points.at(-1));
  return [...new Map(picked.map(p => [p.floor, p])).values()];
}

// Everything the 计划 tab shows: which priority layer is in control, the
// current action and goal with their reasons, the ranked alternatives and
// where their numbers come from, quests, quest points and mastery points.
export function planView(data, planner, trainer, p, {boss = null, engineApi = null} = {}) {
  if (!p?.skills) return null;
  const goal = trainer.goal, style = trainer.style;
  const jobName = id => data.jobs.find(j => j.id === id)?.name ?? `工作 ${id}`;
  const label = c => c.monsterId != null ? `战斗 · ${data.monsters.find(m => m.id === c.monsterId)?.name ?? c.monsterId}` : jobName(c.recipeId);
  const layer = boss?.owned && BOSS_PHASES.has(boss.phase) ? '世界 Boss（最高优先）' :
    trainer.itemTarget && trainer.itemTarget.status !== 'completed' ? '物品目标' :
    goal?.quest ? (goal.quest.period === 'daily' ? '每日任务（必做）' : '每周任务') :
    goal?.upgrade?.priority ? '装备升级' : goal?.hot ? '热门技能' : MODE_LAYERS[trainer.mode] ?? '成长策略';

  let candidates = [], frontier = [];
  try {
    const list = planner.candidates(p, style, trainer.deferred ?? {});
    const priced = new Map((planner.incomeChoices?.(p, list, style) ?? []).map(c => [keyOf(c), c.rate.coins]));
    const rows = list.map(c => ({key: keyOf(c), label: label(c), skill: c.skill, xpH: c.rate.xp * 3600,
      coinsH: (priced.get(keyOf(c)) ?? c.rate.coins) * 3600, source: planner.rateSource?.(p, keyOf(c)) ?? 'formula',
      chosen: goal != null && (goal.monsterId != null ? goal.monsterId === c.monsterId : goal.recipeId != null && goal.recipeId === c.recipeId)}));
    frontier = profitFrontier(rows);
    const byMode = trainer.mode === 'business' ? (a, b) => b.coinsH - a.coinsH : (a, b) => b.xpH - a.xpH;
    candidates = [...rows].sort(byMode).slice(0, 8);
    const chosen = rows.find(r => r.chosen);
    if (chosen && !candidates.includes(chosen)) candidates.push(chosen);
  } catch { /* A planner failure must not hide the rest of the panel. */ }

  let mastery = null;
  try {
    if (typeof engineApi?.masteryEarnedPoints === 'function') {
      const ranks = Object.fromEntries(MASTERY_TRACKS.map(id => [id, Number.isInteger(p.masteries?.[id]) ? p.masteries[id] : 0]));
      mastery = {earned: engineApi.masteryEarnedPoints(p), spent: spentPoints(ranks)};
    }
  } catch { mastery = null; }

  let quests = [], perks = null;
  try { quests = planner.questOverview?.(p, style) ?? []; } catch { quests = []; }
  try { perks = planner.perkOverview?.(p, goal, style) ?? null; } catch { perks = null; }

  return {layer, mode: trainer.mode, profitFloor: planner.profitFloor ?? 0,
    action: trainer.plan ? {label: trainer.plan.label ?? null, reason: trainer.plan.reason ?? null} : null,
    message: trainer.message ?? null,
    goal: goal ? {label: goal.itemTarget ? '物品目标' : goal.quest ? `任务 · ${goal.quest.id}` :
      goal.monsterId != null ? label(goal) : goal.recipeId != null ? jobName(goal.recipeId) : goal.skill ?? null,
      skill: goal.skill ?? null, target: goal.target ?? null, reason: goal.reason ?? null} : null,
    candidates, frontier, quests, perks, mastery};
}
