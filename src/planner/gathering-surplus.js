import {brewPower} from './supplies.js';
import {goldToSeconds, pays} from './gold.js';
import {WORKING_STOCK, combinedBudget, saleProtectionReason} from './inventory.js';
import {autoUsableMaterial} from './quality.js';
import {baseStride, distance, itemLabel, packCapacity, packQty, packUsed, playerQueued, withRarity} from './items.js';

// Gathered output below epic quality is dropped on the spot when the pack room
// it takes is worth more than the item. Every slot carried home costs the walk
// to the bank and back divided by the pack's capacity; those seconds, once
// freed, are spent on this same job, so they are priced at what the job's kept
// output earns per working second. An output is dropped when the seconds it
// frees repay its sale value by the shared payback margin. Cheaper outputs go
// first (a dearer one is dropped only with every cheaper one). Epic and
// legendary output, bonus drops and planned stock are always kept.
// Native onFull:'drop' removes every quality of BOTH main and bonus outputs.
// dropItem matches an exact pack item ID and leaves the active route intact.
export const DROP_BELOW_RARITY=3;
// Batches: half a pack of one output, or at least a few once the room left is
// what the work fills before a drop lands (a planning pass and the command's
// round trip, about ten seconds: fast mining filled the last four slots of a
// pack holding eleven uncommon ores and carried its common ones home), so no
// surplus is carried home and drops stay one every several seconds.
const MIN_BATCH=5,DROP_LATENCY_SECONDS=10;
export function planGatheringSurplus(data,planner,p,goal,style,mode,waitingGoals={},itemId=null) {
  const route=p.route,job=data.jobs.find(j=>j.id===route?.jobId);
  if(!['balanced','experience'].includes(mode)||!goal||goal.quest||goal.upgrade||
    goal.craftPreparation||goal.temporary||goal.developmentFiller||
    !job||!['mining','woodcutting'].includes(job.skill)||job.inputs.length||job.grow||
    goal.skill!==job.skill||!(planner.level(p.skills[job.skill])<goal.target)||
    goal.recipeId!=null&&goal.recipeId!==job.id||p.activity!=='working'||route.phase!=='working'||
    (route.onFull??'bank')!=='bank'||route.errand||route.after||route.limit===0||
    p.workJobId!=null&&p.workJobId!==job.id||p.path?.length||p.enhance||playerQueued(p))return null;
  const base=job.output.itemId,item=data.items[base],site=data.sites.find(s=>s.id===route.siteId);
  if(!site||!site.jobIds.includes(job.id)||distance(p,site)>1||!item||item.stackable||
    base!==planner.base(base)||saleProtectionReason(data,base)||data.gear.some(g=>g.itemId===base)||
    data.jobs.some(j=>j.grow&&j.inputs.some(i=>i.itemId===base)))return null;
  const capacity=packCapacity(p),free=capacity-packUsed(data,p);
  const e=planner.estimateWork(p,job);
  const remaining=Math.min(route.limit??Infinity,Math.ceil(planner.xpTo(p,job.skill,goal.target)/e.xp));
  // Never redirect a trip the work is about to end anyway.
  if(!(remaining*job.output.qty>free)||!(e.seconds>0))return null;
  const arriving=Math.max(MIN_BATCH,Math.ceil(DROP_LATENCY_SECONDS/e.seconds*(job.output.qty+(e.bonusOutput??0)))+1);
  const unit=id=>planner.saleValue?.(p,id,1)??Infinity;
  const tiers=(e.tierOutput??[e.commonOutput]).map((made,r)=>({id:withRarity(data,base,r),made,r,unit:unit(withRarity(data,base,r))}));
  if(tiers.some(t=>!(t.unit>=0)))return null;
  const bonus=job.bonus?(e.bonusOutput??0)*(e.qualities??[1]).reduce((s,q,r)=>s+q*unit(withRarity(data,job.bonus.itemId,r)),0):0;
  if(!Number.isFinite(bonus))return null;
  const stride=Math.round(baseStride(data,p)*(1+.2*brewPower(data,p,'swift')));
  const speed=Math.max(1000,stride,p.strideSpeed??0)/1000;
  const travel=2*Math.min(...data.banks.map(b=>Math.max(0,distance(p,b)-1)))*data.tickMs/1000/speed;
  const plans=[goal,...Object.values(waitingGoals),planner.pendingEquipmentPlan?.(p,style)];
  const budget=combinedBudget(data,planner,p,plans).items;
  const candidates=tiers.filter(t=>t.r<DROP_BELOW_RARITY&&t.made>0&&autoUsableMaterial(data,t.id)).sort((a,b)=>a.unit-b.unit);
  const dropped=new Set();
  for(const t of candidates) {
    dropped.add(t.id);
    // What a working second earns from the output that stays.
    const rate=(tiers.filter(k=>!dropped.has(k.id)).reduce((s,k)=>s+k.made*k.unit,0)+bonus)/e.seconds;
    const carried=packQty(p,t.id),reserve=Math.max(WORKING_STOCK,budget[t.id]??0);
    const qty=Math.min(carried,Math.max(0,(p.bank[t.id]??0)+carried-reserve));
    const value=(planner.saleValue?.(p,t.id,Math.max(1,qty))??Infinity)*qty;
    const saved=travel*qty/capacity,earn=goldToSeconds(value,rate);
    // Judged per unit, so a small batch counts the same as a large one.
    const worth=pays(travel/capacity,goldToSeconds(t.unit,rate));
    if(!worth)break; // a dearer output never goes before a cheaper one
    if(itemId!=null&&t.id!==itemId)continue;
    const due=qty>=Math.ceil(capacity/2)||free<=arriving&&qty>=MIN_BATCH;
    if(!Number.isSafeInteger(qty)||qty<1||!due||!pays(saved,earn))continue;
    return {intent:{t:'dropItem',itemId:t.id,qty},label:`原地清理盈余 · ${itemLabel(data,t.id)} ×${qty}`,
      reason:`每占一格背包要分摊约 ${(travel/capacity).toFixed(1)} 秒往返，这段时间砍出的留用产物约值 ${Math.round(travel/capacity*rate)} 金币，`+
        `高于一件的售价约 ${Math.round(t.unit)} 金币；保留至少 ${reserve} 件周转／计划材料，史诗及以上、副产物都带回；当前采集继续`};
  }
  return null;
}
