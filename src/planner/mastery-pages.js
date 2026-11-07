import {spentPoints, totalCost} from '../engine/mastery-rules.js';
import {action} from './result.js';

// Mastery pages (client 1.0.1210): a second page, bought once, spends the same
// collection points again; switching is free and, since 1.0.1213, has no
// cooldown (the game only suggests the better page; it never switches itself).
// The helper keeps page 1 for work and page 2 for enhancing only: enhancing is
// priced with page 2's odds, and runs only while page 2 is active.
export const WORK_PAGE=1,ENHANCE_PAGE=2;
// Enhance odds: +0.25% per rank, capped at x1.5 (200 ranks).
export const ENHANCE_PER_RANK=.0025,ENHANCE_RANK_CAP=200;
export const hasEnhancePage=p=>p?.masteryOther!=null;
export const pageRanks=(p,page)=>((p?.masteryPage??WORK_PAGE)===page?p?.masteries:p?.masteryOther)??{};
// The enhance ranks enhancing runs with: page 2 holds every point there (as
// many ranks as the points spent on either page buy, up to the cap; points
// earned later count once they are spent); without a second page, the one
// page's own.
export function enhanceRanks(p) {
  if(!hasEnhancePage(p))return p?.masteries?.enhance??0;
  const points=Math.max(spentPoints(pageRanks(p,WORK_PAGE)),spentPoints(pageRanks(p,ENHANCE_PAGE)));
  let ranks=0;
  while(ranks<ENHANCE_RANK_CAP&&totalCost(ranks+1)<=points)ranks++;
  return Math.max(ranks,pageRanks(p,ENHANCE_PAGE).enhance??0);
}
export const enhanceOdds=ranks=>Math.min(1.5,1+ENHANCE_PER_RANK*ranks);
// The page to be on: the enhance page while enhancing is wanted or running,
// else the work page. A switch command; null when on the page.
export function pageStep(p,enhancing) {
  if(!hasEnhancePage(p))return null;
  const want=enhancing?ENHANCE_PAGE:WORK_PAGE;
  if((p.masteryPage??WORK_PAGE)===want)return null;
  return action({t:'masteryPage',page:want},enhancing?'切换到第二页精通 · 强化':'切回第一页精通 · 工作',
    enhancing?'强化只在第二页进行：投资表按这一页的成功率估算强化花费':'没有要做的强化，切回第一页的经验、采集与制作加成');
}
