// The level curve and everything derived from it. One definition for every
// module: XP thresholds, level from XP, levels of a player, and the XP still
// needed to reach a level (never negative, clamped to the last level).
export function createLevels(data) {
  const x=data.xp,thresholds=[0,0];
  for(let level=2;level<=x.journeyLevel;level++)
    thresholds[level]=Math.round(x.baseXp*(x.growth**(level-1)-1)/(x.growth-1));
  let total=thresholds.at(-1),step=total*x.beyondStep;
  while(total+step<=Number.MAX_SAFE_INTEGER) {
    total+=step;thresholds.push(Math.round(total));step*=x.beyondGrowth;
  }
  const maxLevel=thresholds.length-1;
  const level=xp=>{
    let lo=1,hi=maxLevel;
    while(lo<hi) {
      const mid=Math.ceil((lo+hi)/2);
      if(thresholds[mid]<=xp)lo=mid;else hi=mid-1;
    }
    return lo;
  };
  const levels=p=>Object.fromEntries(data.skills.map(s=>[s,level(p.skills[s])]));
  const clampLevel=n=>Math.max(0,Math.min(maxLevel,n));
  // XP at the start of level `n` (clamped).
  const xpAt=n=>thresholds[clampLevel(n)]??0;
  // XP the player still needs in `skill` to reach level `target`.
  const xpTo=(p,skill,target)=>Math.max(0,xpAt(target)-(p.skills?.[skill]??0));
  // XP across one whole level, from `n` to `n+1`.
  const levelSpan=n=>xpAt(n+1)-xpAt(n);
  return {thresholds,maxLevel,level,levels,clampLevel,xpAt,xpTo,levelSpan};
}

// A job the player's level allows.
export const jobUnlocked=(lv,job)=>(lv[job.skill]??0)>=job.levelReq;
