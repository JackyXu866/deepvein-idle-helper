import {autoUsableMaterial} from './professions.js';
import {foodEffects} from './supplies.js';

// Ordinary and rare crops share a pantry reserve, but recipe demands keep
// their exact quality IDs. Growing crops count only as future supply.

// Herbs for potions drunk while herblore is not being trained (one potion lasts
// an hour); training itself makes potions, so this only bridges the gaps.
export const POTION_FLOOR=50;

const herbIds=data=>new Set(data.jobs.filter(j=>j.grow).map(j=>j.output.itemId));
const held=(p,id)=>(p.bank[id]??0)+(p.overflow?.[id]??0)+p.pack.filter(i=>i.itemId===id).reduce((n,i)=>n+i.qty,0);

// Herblore drives herb farming: each level band uses thousands of herbs, one
// per potion. The next recipe is the best-experience unlocked one whose other
// inputs (monster drops) are held; it can use as many herbs as those drops
// allow, and growing more than that is wasted until more drops arrive.
//
// It also plans one unlock ahead: herbs grow slowly, so the next recipe's herb
// is started while the current one runs. With the experience table, the current
// recipe only claims the potions (and shared drops) needed to reach that unlock;
// the remaining drops size the next herb, or it starts with the potion floor.
export function herbloreNeeds(data,p,levels,thresholds=null) {
  const herbs=herbIds(data),level=levels.herblore??1;
  const all=data.jobs.filter(j=>j.skill==='herblore');
  const recipes=all.filter(j=>j.levelReq<=level);
  const spare={},left=id=>spare[id]??held(p,id);
  const drops=recipe=>recipe.inputs.filter(i=>!herbs.has(i.itemId));
  const pairable=recipe=>drops(recipe).length?Math.min(...drops(recipe).map(i=>Math.floor(left(i.itemId)/i.qty))):0;
  const next=[...recipes].sort((a,b)=>Number(pairable(b)>0)-Number(pairable(a)>0)||b.xp-a.xp||b.levelReq-a.levelReq)[0]??null;
  const upcoming=all.filter(j=>j.levelReq>level).sort((a,b)=>a.levelReq-b.levelReq||b.xp-a.xp)[0]??null;
  const xp=p.skills?.herblore;
  const toUnlock=next&&upcoming&&Number.isFinite(thresholds?.[upcoming.levelReq])&&Number.isFinite(xp)?
    Math.max(0,Math.ceil((thresholds[upcoming.levelReq]-xp)/next.xp)):Infinity;
  const potions=next?Math.min(pairable(next),toUnlock):0,recipe={},floor={};
  if(next&&potions>0)for(const i of next.inputs) {
    if(herbs.has(i.itemId))recipe[i.itemId]=potions*i.qty;
    else spare[i.itemId]=left(i.itemId)-potions*i.qty;
  }
  let ahead=null;
  if(upcoming&&Number.isFinite(toUnlock)) {
    const paired=pairable(upcoming),herbsAhead={};
    for(const i of upcoming.inputs)if(herbs.has(i.itemId))herbsAhead[i.itemId]=(paired>0?paired:POTION_FLOOR)*i.qty;
    ahead={recipe:upcoming,potions:paired,herbs:herbsAhead,drops:drops(upcoming).map(i=>i.itemId)};
  }
  for(const r of recipes)for(const i of r.inputs)if(herbs.has(i.itemId))floor[i.itemId]=Math.max(floor[i.itemId]??0,POTION_FLOOR*i.qty);
  return {next,potions,toUnlock,recipe,floor,ahead,drops:next?drops(next).map(i=>i.itemId):[]};
}

// The reserve a crop keeps against sale and aims for when farming: herbs by
// herblore needs, food crops by the food reserve unless a better crop replaces them.
export function cropReserve(data,p,job,levels,herblore=herbloreNeeds(data,p,levels)) {
  const itemId=job.output.itemId,item=data.items[itemId];
  if(data.jobs.some(j=>j.skill==='herblore'&&j.inputs.some(i=>i.itemId===itemId)))
    return Math.max((herblore.recipe[itemId]??0)+(herblore.ahead?.herbs[itemId]??0),herblore.floor[itemId]??0);
  if(!item?.heals)return 0;
  const effects=foodEffects(data,itemId);
  const replaced=data.jobs.some(j=>{
    if(!j.grow||j.id===job.id||j.levelReq>levels.farming)return false;
    const other=data.items[j.output.itemId],buff=foodEffects(data,j.output.itemId);
    return other?.heals>=item.heals&&buff.fedTicks>=effects.fedTicks&&buff.rootedTicks>=effects.rootedTicks&&
      (other.heals>item.heals||buff.fedTicks>effects.fedTicks||buff.rootedTicks>effects.rootedTicks);
  });
  if(replaced)return 0;
  const capacity=28+Math.max(0,p.perks?.pockets??0);
  const carry=p.foodPerTrip===-1?capacity:p.foodPerTrip===-2?Math.max(1,capacity-1):p.foodPerTrip??20;
  return Math.max(500,carry*3);
}

// Crops below target, in priority order: the current plan's shortfall, then
// herbs for the next herblore recipe, then the potion floor and food reserve.
// With nothing short, the planner keeps the fields busy on farming experience.
export function farmingStocks(data,p,levels,goal=null,thresholds=null) {
  const base=id=>id%data.plusScale%data.rarityScale,stock={...p.bank};
  for(const i of p.pack)stock[i.itemId]=(stock[i.itemId]??0)+i.qty;
  for(const [id,qty]of Object.entries(p.overflow??{}))stock[id]=(stock[id]??0)+qty;
  const herblore=herbloreNeeds(data,p,levels,thresholds);
  return data.jobs.filter(j=>j.grow&&j.levelReq<=levels.farming).map(job=>{
    const itemId=job.output.itemId,future={};
    for(const plot of Object.values(p.plots??{}))if(base(plot.seedItemId)===job.inputs[0].itemId) {
      const id=itemId+Math.floor(plot.seedItemId%data.plusScale/data.rarityScale)*data.rarityScale;
      future[id]=(future[id]??0)+3; // Minimum confirmed native yield per field.
    }
    const growing=Object.values(future).reduce((a,b)=>a+b,0);
    const demands=Object.entries(goal?.budget?.items??{}).filter(([id])=>base(+id)===itemId);
    const total=Object.entries(stock).reduce((n,[id,qty])=>n+(autoUsableMaterial(data,+id)&&base(+id)===itemId?qty:0),0);
    const recipeNeed=herblore.recipe[itemId]??0,aheadNeed=herblore.ahead?.herbs[itemId]??0;
    const reserve=cropReserve(data,p,job,levels,herblore);
    const target=Math.max(reserve,demands.reduce((n,[,qty])=>n+qty,0));
    const plannedMissing=demands.reduce((n,[id,qty])=>n+Math.max(0,qty-(stock[id]??0)),0);
    const plannedUncovered=demands.reduce((n,[id,qty])=>n+Math.max(0,qty-(stock[id]??0)-(future[id]??0)),0);
    const missing=Math.max(plannedUncovered,target-total-growing);
    const supply=total+growing;
    // Tiers: plan shortfall, current recipe, the next unlock's herb, reserves.
    const tier=plannedUncovered>0?0:recipeNeed>supply?1:recipeNeed+aheadNeed>supply?1.5:missing>0?2:3;
    const floorNeed=herblore.floor[itemId]??0;
    const reason=plannedMissing>0?'plan':recipeNeed>supply||recipeNeed>0&&!aheadNeed?'herblore':
      aheadNeed>floorNeed&&recipeNeed+aheadNeed>=floorNeed?'ahead':recipeNeed>0?'herblore':'reserve';
    return {job,total,target,plannedMissing,plannedUncovered,missing,tier,reason,
      ...(recipeNeed>0?{herblore:{recipeId:herblore.next.id,potions:herblore.potions,toUnlock:herblore.toUnlock,
        unlockLevel:herblore.ahead?.recipe.levelReq??null,drops:herblore.drops,need:recipeNeed}}:{}),
      ...(aheadNeed>0?{ahead:{recipeId:herblore.ahead.recipe.id,level:herblore.ahead.recipe.levelReq,
        potions:herblore.ahead.potions,drops:herblore.ahead.drops,need:aheadNeed}}:{}),
      short:Math.max(plannedMissing,target-total)};
  }).filter(row=>row.short>0).sort((a,b)=>a.tier-b.tier||
    b.missing/b.target-a.missing/a.target||b.short/b.target-a.short/a.target);
}
