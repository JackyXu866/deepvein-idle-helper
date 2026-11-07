import {canWear, gearRequirementOf, professionSkill, statsDominate} from './professions.js';
import {fitsSlot} from './gear.js';
import {POTION_SALE_RATIO, autoUsableMaterial, craftRecipe, marketPotion, marketQuality} from './quality.js';
import {cropReserve, herbloreNeeds} from './farming.js';
import {COAL_ID, baseId, foodCarry, itemLabel, merchantPrice, plusOf, rarityOf, tradableBase} from './items.js';
import {enhanceOdds, enhanceRanks} from './mastery-pages.js';

// Read-only budgets and quotes; economy.js turns verified surplus into actions.
// Vendor, storage and worn-enhancement rules checked in index-DeoJ7Jh9.js.

export const ENHANCEMENT_BASELINE=5;
// The game's highest +N (client 1.0.1210): the investment table weighs every
// stopping point up to it.
export const ENHANCEMENT_MAX=20;
// Materials kept between batches when nothing plans a larger amount.
export const WORKING_STOCK=50;
// Food kept for fights: the working stock, or three trips' carry if more.
export const foodReserve=p=>Math.max(WORKING_STOCK,foodCarry(p)*3);
// The plans a goal stands for: itself, the goals waiting on it, and the
// development project (often the same goal kept twice, so their coins are
// taken at the most, not added).
function plansOf(planner,p,goal) {
  const development=(goal?.development||goal?.quest)&&planner.developmentRuntime?.();
  return [goal,...goal?.reservedGoals??[],...(development?.owner===p.id?[development.focus,...Object.values(development.parked)]:[])].filter(Boolean);
}
// The coins every spender leaves alone (buying, housing, maintenance, the
// sale review): the most the goal's plans keep, plus a pending equipment
// project's own. One rule for all of them.
export function coinReserve(planner,p,goal,style=planner.styleHint??'magic') {
  const coins=g=>Math.max(0,...plansOf(planner,p,g).map(plan=>plan.budget?.coins??0));
  const project=planner.pendingEquipmentPlan?.(p,style);
  return coins(goal)+(project&&project!==goal?coins(project):0);
}
// One reserve for several plans (the goal, a pending equipment project...):
// each item at the most any plan keeps; the coins by coinReserve.
export function combinedBudget(data,planner,p,plans) {
  const budgets=plans.filter(Boolean).map(plan=>inventoryBudget(data,planner,p,plan));
  if(!budgets.length)return inventoryBudget(data,planner,p,null);
  const [first,...rest]=budgets,items={...first.items};
  for(const other of rest)for(const [id,qty]of Object.entries(other.items))items[id]=Math.max(items[id]??0,qty);
  return {...first,items};
}
// Gear the player keeps whatever the plan: the goal's upgrade targets, the
// piece being enhanced and saved gear sets. A set resolves a missing +N to
// another +N of the same base and quality (client a$), so those count too.
export function lockedGear(data,p,goal=null) {
  const ids=new Set([goal?.upgrade?.id,p.enhance?.itemId].filter(Number.isFinite));
  for(const set of p.gearSets??[])for(const id of Object.values(set?.items??{}))if(Number.isFinite(id))ids.add(id);
  return {ids,variants:new Set([...ids].map(id=>id%data.plusScale))};
}

// Waiting for crops does not make that production batch disposable inventory.
// This view is for maintenance only; it must not replace the active goal.
export function reserveWaitingGoals(goal,waitingGoals={}) {
  const reservedGoals=Object.values(waitingGoals);
  if(!reservedGoals.length)return goal;
  const items={...goal?.budget?.items};
  for(const waiting of reservedGoals)for(const [id,qty]of Object.entries(waiting.budget?.items??{}))
    items[id]=Math.max(items[id]??0,qty);
  return {...goal,reservedGoals,budget:{items,coins:Math.max(goal?.budget?.coins??0,...reservedGoals.map(g=>g.budget?.coins??0))},
    farmingTarget:Math.max(goal?.farmingTarget??0,...reservedGoals.map(g=>g.farmingTarget??0))};
}

// Colour alone does not identify renewable surplus: mounts and rare bonus
// drops also have ordinary IDs. Reuse this gate at the final sale boundary.
export function saleProtectionReason(data,id,marketEquipment=false) {
  const base=baseId(data,id);
  if(!Number.isSafeInteger(id)||!data.items[base])return '未知物品，保留';
  if(!autoUsableMaterial(data,id))return '传说物品由玩家支配，保留';
  if(id===COAL_ID)return '普通煤炭用于所有品质的冶炼，从不出售';
  const marketRare=marketEquipment&&(marketQuality(data,id)||marketPotion(data,id));
  if(id!==base&&!(marketEquipment&&data.gear.some(g=>g.itemId===base))&&!marketRare)return '稀有或已强化物品，保留';
  if(data.gear.some(g=>g.itemId===base&&['mount','pet'].includes(g.slot)))return '坐骑／宠物，所有品质和重复个体均保留';
  if([...data.jobs,...data.monsters].some(row=>row.bonus?.itemId===base))return '低概率副产物／特殊掉落，不按普通盈余处理';
  if(data.jobs.some(j=>j.skill==='herblore'&&j.output.itemId===base)&&!marketRare)return '药水保留待用';
  if(base===data.coinId||base===data.shardId||base===359)return '金币／强化材料／保护卷轴，保留';
  if(base!==70&&!data.jobs.some(j=>j.output.itemId===base)&&!data.monsters.some(m=>m.drop===base))
    return '非普通生产或常规战斗产物，保留';
  return null;
}

// A goal that levels a skill (growth or development stage), not a quest, item
// target, business focus or 补精通: its XP comes before gold.
export const levelingGoal=goal=>!!(goal?.development||goal?.growth)&&!goal.quest&&
  !goal.specialization&&!goal.mastery&&!goal.funding;
// What one unit of a quality item is worth to the current leveling plan, in
// gold: the stage time it saves, at the gold rate. Going into the stage's
// recipe chain at its quality, it brings its share of that craft's XP (and of
// what the craft goes on to make) for its share of the crafting time; without
// it the stage earns that XP at the chain's real rate, gathering included.
// 0 when the plan does not use it. Sold only for more than this.
const chainRates=new Map();
export function planUseValue(data,planner,p,goal,id) {
  const tier=rarityOf(data,id);
  if(!tier||!levelingGoal(goal)||!planner.inputCost)return 0;
  const jobId=goal.craftPreparation?.jobId??goal.recipes?.[goal.skill]??goal.recipeId;
  const root=data.jobs.find(j=>j.id===jobId&&j.skill===goal.skill&&j.inputs.length&&!j.grow);
  if(!root)return 0;
  const key=JSON.stringify([p.id,root.id,p.skills?.[goal.skill],Math.floor(p.lastTick*data.tickMs/60000)]);
  if(!chainRates.has(key)) {
    if(chainRates.size>=16)chainRates.delete(chainRates.keys().next().value);
    const chain=planner.inputCost.recipe(p,root,100,{trained:[goal.skill],stock:{}});
    chainRates.set(key,chain.seconds>0?chain.xp/chain.seconds:0);
  }
  const chainRate=chainRates.get(key);
  if(!(chainRate>0))return 0;
  // XP and crafting seconds carried by one unit of `id` going into `job` at
  // this quality, with `xp`/`time` per unit of `job`'s output carried on.
  const share=(job,xp,time,trail)=>{
    const recipe=craftRecipe(data,job,tier);
    if(!recipe)return null;
    const e=planner.estimateWork(p,recipe),units=recipe.inputs.filter(i=>rarityOf(data,i.itemId)===tier).reduce((n,i)=>n+i.qty,0);
    if(!units)return null;
    const unitXp=(e.xp+xp*e.commonOutput)/units,unitTime=(e.seconds+time*e.commonOutput)/units;
    for(const input of recipe.inputs.filter(i=>rarityOf(data,i.itemId)===tier)) {
      if(input.itemId===id)return {xp:unitXp,time:unitTime};
      if(trail.includes(input.itemId))continue;
      const maker=data.jobs.find(j=>j.output.itemId===baseId(data,input.itemId)&&j.skill===goal.skill&&j.inputs.length&&!j.grow);
      const found=maker&&share(maker,unitXp,unitTime,[...trail,input.itemId]);
      if(found)return found;
    }
    return null;
  };
  const use=share(root,0,0,[root.output.itemId]);
  if(!use)return 0;
  return Math.max(0,use.xp/chainRate-use.time)*(planner.coinRate?.(p)??0);
}
// A plan's cash budget may hold the gold of a worthwhile enhancement step
// (goal.enhancement); `enhancementGold` records how much of it that is. Its own
// coins are the rest. An older build added the step's gold again on every
// maintenance pass without recording it (1,024,020,000 coins live), so such a
// budget's own part is unknown and taken as none.
export function planCoins(goal) {
  const budget=goal?.budget;
  if(!budget)return 0;
  if(goal.enhancement&&budget.enhancementGold==null)return 0;
  return Math.max(0,(budget.coins??0)-(budget.enhancementGold??0));
}
// A task's cash budget is its own: an improvement it cannot afford is funded by
// its own goal (investment.js fundingGoal), never carried by whatever task runs.
// Older builds added an enhancement's gold to every task's budget; a saved
// goal that still holds it is brought back to its own coins.
export function dropEnhancementGold(goal) {
  if(!goal?.enhancement||goal.enhancementProject)return;
  if(goal.budget){goal.budget.coins=planCoins(goal);delete goal.budget.enhancementGold;}
  delete goal.enhancement;
}

export function inventoryBudget(data, planner, p, goal=null,consuming=false) {
  const levels=planner.levels(p), items={...goal?.budget?.items};
  const capacity=p.unlimitedBank||(p.brews?.blessing??0)>p.lastTick?Infinity:
    75+(p.bankSlotsBought??0)+Math.floor((p.house?.storeroom??0)/2);
  const used=Object.values(p.bank).filter(n=>n>0).length;
  const recoverableOverflow=Object.entries(p.overflow??{}).some(([id,n])=>n>0&&
    ((p.bank[id]??0)>0||used<capacity));
  const pressure=used>=capacity-3||Object.values(p.overflow??{}).some(n=>n>0);
  const reserve=(id,qty)=>{items[id]=Math.max(items[id]??0,Math.ceil(qty));};
  // Rare materials for planned gear and matched brews are never disposed of;
  // consuming (brewing, drinking) keeps only the gear part, so the matched
  // pairs can go into the brews they were kept for.
  for(const [id,qty]of Object.entries(planner.qualityHold?.(p,undefined,{gearOnly:consuming})??{}))reserve(Number(id),qty);
  const plans=plansOf(planner,p,goal);
  const recipes=new Map();
  for(const plan of plans) {
    for(const [id,qty]of Object.entries(plan.budget?.items??{}))reserve(Number(id),qty);
    for(const [skill,id]of Object.entries(plan.recipes??{}))recipes.set(id,plan.recipeRarities?.[skill]??0);
    if(plan.recipeId!=null&&!recipes.has(plan.recipeId)) {
      // A 补精通 craft holds the inputs of its target quality.
      const job=data.jobs.find(j=>j.id===plan.recipeId);
      recipes.set(plan.recipeId,job?.inputs.length&&!job.grow?plan.mastery?.rarity??0:0);
    }
  }
  // A leveling stage keeps everything it counts as its supply (planner.stageSupply).
  for(const plan of plans.filter(levelingGoal))
    for(const [id,qty]of Object.entries(planner.stageSupply?.(p,plan)??{}))reserve(Number(id),qty);
  for(let route=p.route;route;route=route.after)if(route.jobId!=null)recipes.set(route.jobId,route===p.route?p.workRarity??route.rarity??0:route.rarity??0);
  for(const [id,tier]of recipes) {
    const original=data.jobs.find(j=>j.id===id),job=original&&craftRecipe(data,original,tier);
    if(job)for(const input of job.inputs)material(input.itemId,input.qty*WORKING_STOCK);
  }
  function material(id,qty,trail=[]) {
    reserve(id,qty);
    if(trail.includes(id))return;
    const sources=data.jobs.filter(j=>j.output.itemId===planner.base(id))
      .map(j=>craftRecipe(data,j,rarityOf(data,id))).filter(Boolean).sort((a,b)=>a.levelReq-b.levelReq);
    const job=sources.find(j=>levels[j.skill]>=j.levelReq)??null;
    if(job)for(const input of job.inputs)material(input.itemId,
      Math.ceil(qty/job.output.qty)*input.qty,[...trail,id]);
  }
  for(const upgrade of plans.map(plan=>plan.upgrade))
    if(upgrade?.id!=null)material(upgrade.id%data.plusScale,1);
  // Food is a renewable supply, but a reserve must survive a sale and a new trip.
  for(const item of Object.values(data.items))if(item.heals)reserve(item.id,foodReserve(p));
  // A replenishable pantry protects against disposal, not useful consumption.
  if(!consuming&&levels.farming>=Math.max(...data.farmUnlocks)) {
    const herblore=herbloreNeeds(data,p,levels,planner.thresholds);
    for(const job of data.jobs.filter(j=>j.grow&&j.levelReq<=levels.farming))reserve(job.output.itemId,cropReserve(data,p,job,levels,herblore));
  }
  return {items,coins:coinReserve(planner,p,goal),capacity,used,freeSlots:capacity-used,pressure,recoverableOverflow};
}
// One snapshot's enhance odds from masteries (the table asks for hundreds of quotes).
const masteryOdds=new WeakMap();
// An item's enhancement tier, 0-5 (client L0): its recipe level against the
// thresholds; tier 4 (index 3) without a recipe.
export function enhanceTier(data,itemId) {
  const recipe=data.jobs.find(j=>j.output.itemId===baseId(data,itemId));
  return recipe?data.enhanceThresholds.filter(v=>recipe.levelReq>=v).length:3;
}
export function enhanceQuote(data, planner, p, itemId) {
  const n=plusOf(data,itemId),rarity=rarityOf(data,itemId),tier=enhanceTier(data,itemId);
  const house=p.houseFurniture?.lectern?1+.01*(p.house?.lectern??0):1;
  // Client 1.0.1189: each Enhancing level above 1 multiplies the odds by +0.2%.
  const skill=1+.002*((planner.levels(p).enhancing??1)-1);
  // Enhancing runs on the enhance page (mastery-pages.js), so it is priced with its odds.
  if(!masteryOdds.has(p))masteryOdds.set(p,enhanceOdds(enhanceRanks(p)));
  const chance=Math.min(1,Math.max(.2,1-.06*n)*house*skill*masteryOdds.get(p));
  return {fromPlus:n,toPlus:n+1,chance,gold:data.enhanceGold[tier]*[1,3,8,20,50][rarity]*(n+1),
    shards:data.enhanceShards*(n+1),xp:Math.round(20*(n+1)*data.rarityXp[rarity]),
    failurePlus:0};
}

// Item groups that depend on the game data only, built once per data object.
const itemGroups=new WeakMap();
function groupsOf(data) {
  if(!itemGroups.has(data))itemGroups.set(data,{
    seeds:new Set(data.jobs.filter(j=>j.grow).flatMap(j=>j.inputs.map(i=>i.itemId))),
    inputs:new Set(data.jobs.flatMap(j=>j.inputs.map(i=>i.itemId))),
    houseMaterials:new Set([...data.jobs.filter(j=>['mining','woodcutting','fishing','farming'].includes(j.skill))
      .map(j=>j.output.itemId),...data.monsters.map(m=>m.drop)])});
  return itemGroups.get(data);
}

// `only`: review just these items (the same verdicts, without the rest of the
// bank); the income table asks about one product at a time.
export function reviewInventory(data, planner, p, goal=null, style='magic',budget=inventoryBudget(data,planner,p,goal),{only=null}={}) {
  const lv=planner.levels(p);
  const name=id=>itemLabel(data,id);
  const {seeds,inputs,houseMaterials}=groupsOf(data);
  const stock=new Map();
  const add=(id,qty,place)=>{
    if(!qty||!Number.isFinite(id)) return;
    if(!stock.has(id))stock.set(id,{itemId:id,name:name(id),bank:0,pack:0,worn:0,overflow:0});
    stock.get(id)[place]+=qty;
  };
  Object.entries(p.bank).forEach(([id,qty])=>add(Number(id),qty,'bank'));
  p.pack.forEach(i=>add(i.itemId,i.qty,'pack'));
  Object.values(p.equipment).forEach(id=>add(id,1,'worn'));
  Object.entries(p.overflow??{}).forEach(([id,qty])=>add(Number(id),qty,'overflow'));
  // The gear comparisons below need every held piece; they are built only
  // when a piece of gear is reviewed (the income table asks about one product
  // at a time, usually not gear).
  let gearIndex=null;
  const gearOf=()=>gearIndex??=(()=>{
    const held=[...stock.values()].filter(row=>row.bank+row.pack+row.worn>0).map(row=>planner.equipmentStats(row.itemId)).filter(Boolean);
    const lines=new Map(),copies=new Map();
    for(const h of held){const key=line(h);if(!lines.has(key))lines.set(key,[]);lines.get(key).push(h);}
    for(const row of stock.values())if(row.bank+row.pack+row.worn+row.overflow>0) {
      const g=planner.equipmentStats(row.itemId),b=planner.base(row.itemId);
      if(g){if(!copies.has(b))copies.set(b,[]);copies.get(b).push(g);}
    }
    return {lines,copies};
  })();
  // What the current batch uses (any quality) is judged when it ends, and so
  // is what it makes when it has an end: an endless route (a funding or
  // leveling stretch) never ends, so its output is judged as it comes.
  const routeJob=p.route&&!p.route.errand?data.jobs.find(j=>j.id===p.route.jobId):null;
  const batchBases=new Set(routeJob?[...(p.route.limit>0?[routeJob.output.itemId]:[]),...routeJob.inputs.map(i=>i.itemId)]:[]);
  const batchItem=id=>batchBases.has(baseId(data,id));
  const {ids:locked,variants:lockedVariants}=lockedGear(data,p,goal);
  const requirement=g=>gearRequirementOf(data,g.itemId).level;
  const wearable=g=>canWear(data,lv,g.itemId);
  const sourced=new Map();
  const selfSource=(id,trail=[])=>{
    if(!trail.length&&sourced.has(id))return sourced.get(id);
    const result=!trail.includes(id)&&(id===data.coinId||data.jobs.some(j=>
      j.output.itemId===id&&lv[j.skill]>=j.levelReq&&j.inputs.every(i=>selfSource(i.itemId,[...trail,id]))));
    if(!trail.length)sourced.set(id,result);
    return result;
  };
  // Gear is compared within its own line (slot, style, weapon type), for every
  // style. A better piece replaces it only once that piece can be worn no later
  // than this one, so the wearable-now piece for a lower level is kept.
  const line=g=>[g.slot,g.style??'',g.needs??'',!!g.twoHanded,g.slot==='weapon'&&g.needs==='ranged'?g.speed:''].join('|');
  // Two held pieces compared as the gear step compares them (ownedBest): the
  // profession's own gear by the investment table's rate, stats on a tie; gear
  // of another style by `otherwise` (it has no rate for this profession).
  const own=g=>fitsSlot(g,g.slot,data.toolSkills[g.slot]??professionSkill(style),style);
  const beats=(h,g,otherwise)=>{
    if(!own(h)||!own(g)||!planner.gearRate)return otherwise(h,g);
    const skill=data.toolSkills[g.slot]??professionSkill(style),rate=id=>planner.gearRate(p,style,goal,g.slot,id);
    return (rate(h.itemId)-rate(g.itemId)||(planner.gearScore?.(h.itemId,skill)??0)-(planner.gearScore?.(g.itemId,skill)??0))>0;
  };
  function dominated(g) {
    return (gearOf().lines.get(line(g))??[]).some(h=>h.itemId!==g.itemId&&
      (wearable(h)||requirement(h)<=requirement(g))&&beats(h,g,statsDominate));
  }
  // Of one piece of gear only the best copy (other styles: the highest rarity,
  // then enhancement) is a possible upgrade; the rest are surplus even before
  // they can be worn.
  const rank=id=>rarityOf(data,id)*1000+plusOf(data,id);
  const superseded=id=>{
    const g=planner.equipmentStats(id);
    return !!g&&(gearOf().copies.get(planner.base(id))??[]).some(h=>h.itemId!==id&&beats(h,g,(a,b)=>rank(a.itemId)>rank(b.itemId)));
  };
  const reviewed=only?[...stock.values()].filter(row=>only.includes(row.itemId)):[...stock.values()];
  const items=reviewed.map(row=>{
    const id=row.itemId,base=planner.base(id),g=planner.equipmentStats(id);
    const total=row.bank+row.pack+row.worn+row.overflow;
    let keep=total,reason='用途未完全覆盖，先保留',category='保留';
    const potionSale=marketPotion(data,id)&&planner.potionSaleWorth?.(p,id)===true;
    const marketOnly=!!g&&id!==base||marketQuality(data,id)||potionSale;
    const protectedReason=saleProtectionReason(data,id,marketOnly);
    if(protectedReason)reason=protectedReason;
    else if(locked.has(id)||lockedVariants.has(id%data.plusScale))reason='装备方案／当前打造或强化目标';
    else if(potionSale){keep=0;reason=`稀有药水的买单价超过同等药效最便宜来源的 ${POTION_SALE_RATIO} 倍：只挂市场出售，自用较便宜的药水`;}
    else if(marketOnly&&!g&&batchItem(id)){keep=total;reason='当前批次正在制作或使用它：批次结束后再决定是否出售';}
    else if(marketOnly&&!g) {
      // Kept exactly as far as a plan counts it (budget: a leveling stage's
      // supply, planned gear, brews); the rest is sold.
      const reserved=Math.min(total,budget.items[id]??0);
      keep=reserved;
      reason=reserved>=total?'计划要用（练级阶段计入、计划装备或药水），保留':
        `稀有加工品／矿石：计划不用的 ${total-reserved} 件按同品质近期成交价只挂市场，不转系统回收`;
    }
    else if(marketOnly) {
      keep=row.worn;
      if(superseded(id))reason='已持有同款更高品质／强化的一件；按原品质和强化等级仅售市场';
      else if(dominated(g))reason='同类已有更好且不晚于它可穿戴的装备；按原品质和强化等级仅售市场';
      else {keep=Math.max(1,keep);reason='该职业同类最高品质且可能成为升级，保留一件；重复的仅售市场';}
    }
    else if(seeds.has(base))reason='种子用于持续补种，不作为普通盈余出售';
    else if(data.items[base]?.heals) {keep=Math.min(total,budget.items[base]??foodReserve(p));reason='保留至少三趟战斗食物及当前计划需要量';}
    else if(inputs.has(base)||houseMaterials.has(base)) {
      const renewable=selfSource(base)||data.monsters.some(m=>m.drop===base);
      const planned=budget.items[base]??0;
      if(renewable||planned>0) {
        keep=Math.min(total,Math.max(planned,budget.pressure?0:WORKING_STOCK));
        reason=planned?'保留当前批次、供料链和打造需要量':budget.pressure?
          '仓库紧张，出售暂未纳入计划且可自行重新采集的普通库存':'保留 50 件周转材料，出售明确盈余';
      } else reason='尚无可用自给来源或后续用途未预算，保留';
    }
    else if(base===70) {keep=0;category='可卖候选';reason='烧焦食物，出售回收金币';}
    else if(g) {
      keep=row.worn;
      if(!dominated(g)&&!superseded(id))keep=Math.max(1,keep);
      keep=Math.min(total,keep);
      category=keep<total?'可卖候选':'保留';
      reason=superseded(id)?'已持有同款更高品质的一件；普通品质的出售':
        dominated(g)?'同类已有更好且不晚于它可穿戴的装备；已穿戴的仍保留':
        '保留一件未被替代的工具／装备（各职业分别保留），重复成品可处理';
    }
    keep=Math.max(keep,Math.min(total,budget.items[id]??0),row.worn);
    const sell=tradableBase(data,base)?Math.max(0,total-keep):0,vendorUnit=merchantPrice(data,base);
    if(sell>0)category='可卖候选';
    return {...row,total,keep,sell,sellFromBank:Math.min(row.bank,sell),
      sellFromPack:Math.min(row.pack,Math.max(0,sell-row.bank)),vendorUnit,category,reason,marketOnly,
      estimatedCoins:sell*vendorUnit};
  });
  // The 物资 tab's enhancement list is the investment table's enhance rows:
  // the stopping point, the expected cost with failures, the time it saves
  // over the piece's use and the verdict the enhancing step acts on.
  const enhancements=only?[]:(planner.investmentOptions?.(p,style,goal)??[]).filter(r=>r.kind==='enhance').map(r=>{
    const quote=enhanceQuote(data,planner,p,r.current);
    return {itemId:r.current,name:name(r.current),slot:r.slot,fromPlus:plusOf(data,r.current),toPlus:r.toPlus,
      gold:r.coins,shards:r.shards,chance:quote.chance,gain:r.gain,paidHours:r.paid/3600,savedHours:r.saved/3600,
      worth:r.worth,cheapest:r.cheapest,affordable:r.affordable,
      recommendation:!r.worth?'不回本，不强化':!r.cheapest?'值得，但这个位置有更省的升级':r.affordable?'值得，可做（按投资表强化）':'值得，待筹资'};
  });
  return {items,enhancements,budget};
}
