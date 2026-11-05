// Mastery rules (client 1.0.1210): rank n costs 38 + 2n points, at most 200 ranks per track.
export const MASTERY_TRACKS = ['xp', 'gather', 'craft', 'offline', 'move', 'hp', 'maxhit', 'accuracy', 'rare', 'enhance'];
export const MASTERY_RANK_LIMIT = 200;
export const MASTERY_NAMES_ZH = {xp: '经验获取', gather: '采集速度', craft: '制作速度', offline: '离线时长', move: '移动速度',
  hp: '生命上限', maxhit: '最大伤害', accuracy: '命中', rare: '寻宝', enhance: '强化成功率'};
// Effect per rank (client Md): accuracy +1%, enhance +0.25%, the rest +0.5%.
export const MASTERY_PER_RANK = {xp: .005, gather: .005, craft: .005, offline: .005, move: .005, hp: .005,
  maxhit: .005, accuracy: .01, rare: .005, enhance: .0025};
// Gather speed serves these skills; craft speed the rest that make things (client df).
export const GATHER_SKILLS = ['mining', 'fishing', 'woodcutting', 'farming', 'thieving'];
export const masteryLift = (ranks, id) => 1 + (MASTERY_PER_RANK[id] ?? 0) * (ranks?.[id] ?? 0);
export const rankCost =n => 38 + 2 * Math.max(1, Math.floor(n));
export const totalCost = n => { n = Math.max(0, Math.floor(n)); return 38 * n + n * (n + 1); };
export const spentPoints = ranks => Object.values(ranks).reduce((sum, n) => sum + totalCost(n), 0);
