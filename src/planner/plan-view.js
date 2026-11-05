import {MASTERY_TRACKS, spentPoints} from '../engine/mastery-rules.js';
import {NAMES} from './planner.js';
import {RARITY_NAMES} from './quality.js';
import {combatKey, jobKey} from './keys.js';

const MODE_LAYERS = {balanced: '自主发展计划', experience: '经验优先', business: '主业经营', assist: '只收菜＋蹭世界 Boss'};
const BOSS_PHASES = new Set(['ready', 'saving', 'moving', 'attacking', 'fighting', 'dead', 'ended', 'resuming']);

const keyOf = c => c.monsterId != null ? combatKey(c.monsterId) : jobKey(c.recipeId, c.rarity);
// The recipe (and quality) or monster a goal is actually running.
const running = goal => !goal ? null : goal.monsterId != null ? {monsterId: goal.monsterId} :
  (goal.craftPreparation?.jobId ?? goal.recipes?.[goal.skill] ?? goal.recipeId) == null ? null :
  {recipeId: goal.craftPreparation?.jobId ?? goal.recipes?.[goal.skill] ?? goal.recipeId,
    rarity: goal.craftPreparation ? goal.craftPreparation.rarity ?? 0 : goal.recipeRarities?.[goal.skill] ?? 0};

// Best XP/hour for each gold/hour floor: the Pareto frontier of the
// candidates, as a short list of suggestions (at most `limit`, spread out).
export function profitFrontier(rows, limit = 5) {
  const sorted = rows.filter(r => r.xpH > 0).sort((a, b) => b.coinsH - a.coinsH || b.xpH - a.xpH);
  const frontier = [];
  let bestXp = -1;
  for (const r of sorted) if (r.xpH > bestXp) { frontier.push(r); bestXp = r.xpH; }
  frontier.reverse(); // ascending gold: [max XP first ... most gold last]
  const maxXp = frontier[0]?.xpH ?? 0;
  // Each button shows what that floor actually picks: the highest-XP job
  // earning at least the (rounded) floor, the helper's own rule.
  const bestAt = floor => sorted.filter(r => r.coinsH >= floor).sort((a, b) => b.xpH - a.xpH || b.coinsH - a.coinsH)[0];
  const points = frontier.map((r, i) => {
    const floor = i === 0 ? 0 : Math.max(0, Math.floor(r.coinsH / 100) * 100), pick = bestAt(floor) ?? r;
    return {floor, label: pick.label, xpH: pick.xpH, coinsH: pick.coinsH, loss: maxXp > 0 ? 1 - pick.xpH / maxXp : 0};
  });
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
  const label = c => c.monsterId != null ? `战斗 · ${data.monsters.find(m => m.id === c.monsterId)?.name ?? c.monsterId}` :
    `${c.rarity ? RARITY_NAMES[c.rarity] : ''}${jobName(c.recipeId)}`;
  const layer = boss?.owned && BOSS_PHASES.has(boss.phase) ? '世界 Boss（最高优先）' :
    goal?.quest ? (goal.quest.period === 'daily' ? '每日任务（必做）' : goal.quest.period === 'order' ? '城镇订单' : '每周任务') :
    goal?.upgrade?.priority ? '装备升级' : goal?.hot ? '热门技能' : MODE_LAYERS[trainer.mode] ?? '成长策略';

  // Experience is not comparable between skills (each has its own XP scale and
  // level table), so XP is ranked only within the skill being levelled toward
  // its next unlock. Gold is comparable everywhere and is ranked across skills.
  let xpSkill = null, xpAcross = false, xpBasis = null, xpCandidates = [], goldCandidates = [], frontier = [];
  try {
    const list = planner.candidates(p, style, trainer.deferred ?? {});
    // One income table: the very rows the gold rate is read from (incomeRows),
    // so the gold column is what the helper works with.
    const income = planner.incomeRows?.(p, style) ?? [];
    const priced = new Map(income.map(r => [r.key, r.coins]));
    // ★ marks what is actually running: the recipe and quality the recipe
    // choice went with (goal.recipeId is only where the project started).
    const run = running(goal);
    const chosen = c => run != null && (run.monsterId != null ? run.monsterId === c.monsterId :
      run.recipeId === c.recipeId && run.rarity === (c.rarity ?? 0));
    const rows = list.map(c => ({key: keyOf(c), label: label(c), skill: c.skill, skillName: NAMES[c.skill] ?? c.skill, xpH: c.rate.xp * 3600,
      // Gold as the gold table prices it; a job absent from it earns nothing there.
      coinsH: (priced.get(keyOf(c)) ?? 0) * 3600, source: planner.rateSource?.(p, keyOf(c)) ?? 'formula', chosen: chosen(c)}));
    const incomeView = income.map(r => ({key: r.key, label: `${label(r)}${r.goldRate ? '（金币效率）' : r.oneOff ? '（库存批次，一次性）' : ''}`,
      skill: r.skill, skillName: NAMES[r.skill] ?? r.skill, xpH: r.xp * 3600, coinsH: r.coins * 3600,
      source: planner.rateSource?.(p, r.key) ?? 'formula', chosen: chosen(r), goldRate: !!r.goldRate, oneOff: r.oneOff}));
    frontier = profitFrontier(rows);
    const top = (sorted, keep) => {
      const shown = sorted.slice(0, 8), chosen = keep.find(r => r.chosen);
      if (chosen && !shown.includes(chosen)) shown.push(chosen);
      return shown;
    };
    // 经验优先 deliberately trades skills against each other on raw XP.
    xpAcross = trainer.mode === 'experience';
    xpSkill = xpAcross || goal?.quest ? null : goal?.mainSkill ?? goal?.skill ?? null;
    // Within the goal's skill: the recipe choice's own ratings (whole stage
    // with its gathering, or the batch score), not a separate estimate.
    const ratings = planner.recipeRatings?.();
    if (!xpAcross && xpSkill && ratings?.skill === xpSkill && ratings.playerId === p.id) {
      xpBasis = ratings.basis;
      const rated = ratings.rows.map(r => {const key = jobKey(r.recipeId, r.rarity);
        return {key, label: label(r), skill: xpSkill, skillName: NAMES[xpSkill] ?? xpSkill, xpH: r.xp * 3600,
          coinsH: (priced.get(key) ?? 0) * 3600, source: planner.rateSource?.(p, key) ?? 'formula',
          chosen: r.recipeId === ratings.chosen.recipeId && r.rarity === ratings.chosen.rarity};});
      xpCandidates = top(rated, rated);
    } else {
      // 经验优先 picks among the jobs meeting the profit floor (when any do).
      const floor = xpAcross ? planner.profitFloor ?? 0 : 0;
      const pool = xpAcross ? rows : rows.filter(r => r.skill === xpSkill);
      const compared = floor > 0 && pool.some(r => r.coinsH >= floor) ? pool.filter(r => r.coinsH >= floor) : pool;
      xpCandidates = top([...compared].sort((a, b) => b.xpH - a.xpH), compared);
    }
    goldCandidates = top(incomeView, incomeView);
    if (!goldCandidates.some(r => r.goldRate)) {
      const rate = incomeView.find(r => r.goldRate);
      if (rate) goldCandidates.push(rate);
    }
  } catch { /* A planner failure must not hide the rest of the panel. */ }

  let mastery = null;
  try {
    if (typeof engineApi?.masteryEarnedPoints === 'function') {
      const ranks = Object.fromEntries(MASTERY_TRACKS.map(id => [id, Number.isInteger(p.masteries?.[id]) ? p.masteries[id] : 0]));
      const choice = planner.masteryPurchase?.(p, trainer.goal);
      mastery = {earned: engineApi.masteryEarnedPoints(p), spent: spentPoints(ranks), plan: choice?.label ?? null, reason: choice?.reason ?? null};
    }
  } catch { mastery = null; }

  // Gold as time: each way to improve worn gear, its cost in hours of gold
  // work and the hours it saves while used (planner/investment.js).
  let investments = [];
  try {
    // Every worthwhile row, and each slot's three best options whatever their
    // verdict: a slot's alternatives (an epic Meteoric hoe that does not pay
    // back) used to fall below a cut at eight rows and looked never considered.
    const all = planner.investmentOptions?.(p, style, goal) ?? [], seen = {};
    const shown = all.filter(r => {seen[r.slot] = (seen[r.slot] ?? 0) + 1; return r.worth || r.funding || seen[r.slot] <= 3;});
    investments = shown.map(r => ({label: r.label, kind: r.kind,
      gold: r.gold, paidHours: r.paid / 3600, savedHours: r.saved / 3600, useHours: r.useSeconds / 3600, gain: r.gain,
      worth: r.worth, cheapest: r.cheapest, affordable: r.affordable, source: r.source, project: !!r.project,
      funding: goal?.funding?.key === `${r.kind}:${r.id}`}));
  } catch { investments = []; }
  const funding = goal?.funding ? {label: goal.funding.label, gold: goal.funding.gold,
    minutesLeft: Math.max(0, Math.ceil((goal.funding.until - p.lastTick) * data.tickMs / 60000))} : null;

  let quests = [], perks = null;
  try { quests = planner.questOverview?.(p, style, trainer.questDeferred ?? {}) ?? []; } catch { quests = []; }
  // Town orders, each with the verdict the choice uses (town-orders.js), not in assist mode.
  let orders = [];
  try { orders = trainer.mode === 'assist' ? [] : planner.orderOverview?.(p, style, trainer.questDeferred ?? {}) ?? []; } catch { orders = []; }
  try { perks = planner.perkOverview?.(p, goal, style) ?? null; } catch { perks = null; }

  return {layer, mode: trainer.mode, profitFloor: planner.profitFloor ?? 0,
    action: trainer.plan ? {label: trainer.plan.label ?? null, reason: trainer.plan.reason ?? null} : null,
    message: trainer.message ?? null,
    // A level goal is about the skill; its recipe or monster is only the
    // current means of getting there.
    goal: goal ? (goal.quest ? {label: `${goal.quest.period === 'daily' ? '每日任务' : goal.quest.period === 'order' ? '城镇订单' : '每周任务'} · ${label(goal.quest.monsterId != null ? {monsterId: goal.quest.monsterId} : {recipeId: goal.quest.jobId})}`,
        target: null, via: null, reason: goal.reason ?? null} :
      {label: goal.skill ? NAMES[goal.skill] ?? goal.skill : null, target: goal.target ?? null,
        via: running(goal) ? label(running(goal)) : null, reason: goal.reason ?? null}) : null,
    xpSkill, xpSkillName: xpSkill ? NAMES[xpSkill] ?? xpSkill : null, xpAcross, xpBasis, xpCandidates, goldCandidates, frontier, investments, funding, quests, orders, perks, mastery};
}
