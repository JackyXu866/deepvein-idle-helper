import {ENHANCEMENT_BASELINE, enhanceQuote} from './inventory.js';
import {combatEstimate} from './estimates.js';
import {combatStats as sharedCombatStats, formulaWork} from './rates.js';
import {canWear, professionSkill} from './professions.js';
import {LEGENDARY, autoUsableMaterial, craftRecipe} from './quality.js';
import {baseId, heldIds, itemLabel, plusOf, rarityOf} from './items.js';
import {goldToSeconds, payback} from './gold.js';
import {COMBAT_SLOTS, fitsSlot, shieldless, useSeconds as sharedUseSeconds} from './gear.js';
export {USE_CAP_SECONDS} from './gear.js';

// A funding stretch on the best gold job lasts at most this long.
export const FUNDING_CAP_SECONDS=3600;
const FUNDING_RETRY_SECONDS=6*3600,CACHE_SECONDS=60;

// Expected gold and shards to take an item from its current +N to `toPlus`.
// A failed attempt resets it to +0, so step k costs (g + (1-s)·E_k)/s, where
// E_k is the expected cost of rebuilding +k from +0 (client 1.0.1189 odds).
export function expectedEnhancement(data,planner,p,itemId,toPlus) {
  const base=itemId%data.plusScale,from=plusOf(data,itemId);
  let gold=0,shards=0,fromGold=0,fromShards=0;
  for(let k=0;k<toPlus;k++) {
    const quote=enhanceQuote(data,planner,p,base+k*data.plusScale),s=quote.chance;
    if(!(s>0))return {gold:Infinity,shards:Infinity};
    gold+=(quote.gold+(1-s)*gold)/s;shards+=(quote.shards+(1-s)*shards)/s;
    if(k+1===from){fromGold=gold;fromShards=shards;}
  }
  return {gold:gold-fromGold,shards:shards-fromShards};
}

export function createInvestments(data,planner) {
  let cache=null,fundingDeferred={};
  const lvOf=p=>planner.levels(p);
  const combatStats=(p,equipment,style)=>sharedCombatStats(data,planner,p,style,equipment,lvOf(p));
  // What each slot is used for: the monster being fought, or the job its tool serves.
  function contexts(p,style,goal) {
    const skill=professionSkill(style),lv=lvOf(p);
    const monster=data.monsters.find(m=>m.id===(goal?.monsterId??data.zones.find(z=>z.id===p.route?.zoneId)?.monsterId))??
      (planner.combatOptions?.(p,style)??[]).map(c=>c.monster).sort((a,b)=>{
        const rate=m=>{const e=combatEstimate(data,m,combatStats(p,p.equipment,style));return e.mainXp/e.seconds;};
        return rate(b)-rate(a);
      })[0]??null;
    const jobFor=toolSkill=>data.jobs.find(j=>j.id===(goal?.recipes?.[toolSkill]??(goal?.skill===toolSkill?goal.recipeId:null)))??
      data.jobs.find(j=>j.id===p.route?.jobId&&j.skill===toolSkill)??
      data.jobs.filter(j=>j.skill===toolSkill&&!j.grow&&lv[toolSkill]>=j.levelReq&&data.sites.some(s=>s.jobIds.includes(j.id)))
        .sort((a,b)=>{const r=j=>{const e=formulaWork(data,planner,p,j,lv);return e.xp/e.seconds;};return r(b)-r(a);})[0]??null;
    return {skill,monster,jobFor};
  }
  // XP per second with `slot` holding `id`, by the game formulas on both sides
  // of a swap (a measurement only exists for the current equipment).
  function rate(p,style,ctx,slot,id) {
    const equipment={...p.equipment,[slot]:id},toolSkill=data.toolSkills[slot];
    if(toolSkill) {
      const job=ctx.jobFor(toolSkill);if(!job)return 0;
      const e=formulaWork(data,planner,p,job,lvOf(p),equipment);
      return e.xp/e.seconds;
    }
    if(!ctx.monster)return 0;
    const e=combatEstimate(data,ctx.monster,combatStats(p,equipment,style));
    return e.mainXp/e.seconds;
  }

  // Cheapest way to get an item: owned, made (time and bought inputs) or bought.
  function acquire(p,id,coinRate) {
    if(planner.count(p,id)>0)return {gold:0,seconds:0,source:'已持有'};
    const options=[];
    const job=data.jobs.find(j=>j.output.itemId===baseId(data,id)&&j.inputs.length&&!j.grow);
    if(job&&rarityOf(data,id)>0&&craftRecipe(data,job,rarityOf(data,id))) {
      const made=planner.crafting.estimate(p,id,1,{buy:true});
      if(Number.isFinite(made.seconds))options.push({gold:made.money??0,seconds:made.seconds,source:'自制'});
    } else if(job) {
      const made=planner.routeEstimate(p,job,1,{});
      if(Number.isFinite(made.seconds))options.push({gold:made.budget?.coins??0,seconds:made.seconds,source:'自制'});
    }
    const ask=planner.marketAsk?.(p,id);
    if(ask>0)options.push({gold:ask,seconds:0,source:'市场'});
    const cost=o=>o.seconds+goldToSeconds(o.gold,coinRate);
    return options.sort((a,b)=>cost(a)-cost(b))[0]??null;
  }
  function slotsFor(p,style) {
    const twoHanded=shieldless(style,planner.equipmentStats(p.equipment.weapon));
    return [...COMBAT_SLOTS.filter(s=>s!=='shield'||!twoHanded),
      ...Object.keys(data.toolSkills).filter(s=>s!=='hoe'&&planner.trainedSkills(style).includes(data.toolSkills[s]))];
  }
  // Every worthwhile way to improve each worn piece, on the same terms.
  function compute(p,style,goal) {
    const ctx=contexts(p,style,goal),coinRate=planner.coinRate?.(p)??0,lv=lvOf(p),rows=[];
    const shardValue=planner.saleValue(p,data.shardId,1);
    for(const slot of slotsFor(p,style)) {
      const current=p.equipment[slot],worn=planner.equipmentStats(current);
      if(!worn||slot==='mount')continue;
      const useSkill=data.toolSkills[slot]??ctx.skill,useSeconds=(id,rate)=>sharedUseSeconds(data,planner,p,id,slot,rate,useSkill);
      const fits=id=>fitsSlot(planner.equipmentStats(id),slot,useSkill,style);
      if(!fits(current))continue;
      const before=rate(p,style,ctx,slot,current);
      if(!(before>0))continue;
      // Pieces already in the bank or pack, of any quality: wearing keeps a
      // legendary piece with the player. Nothing is bought or made that is no
      // better than the best of them.
      const ownedIds=heldIds(p)
        .filter(id=>id!==current&&fits(id)&&canWear(data,lv,id)&&rate(p,style,ctx,slot,id)>before)
        .sort((a,b)=>rate(p,style,ctx,slot,b)-rate(p,style,ctx,slot,a)||a-b);
      const floor=ownedIds.length?Math.max(before,rate(p,style,ctx,slot,ownedIds[0])):before;
      const priced=(kind,id,label,cost,extra={})=>{
        if(!cost)return null;
        const after=rate(p,style,ctx,slot,id);
        if(!(after>before))return null;
        const use=useSeconds(id,after),result=payback({gold:cost.gold,seconds:cost.seconds,coinRate,before,after,useSeconds:use});
        return {slot,kind,id,label,current,source:cost.source??null,gold:Math.round(cost.gold),seconds:cost.seconds,
          gain:after/before-1,useSeconds:use,...result,...extra};
      };
      const add=(...args)=>{const row=priced(...args);if(row)rows.push(row);};
      // Every quality of a piece that beats the floor, priced; the best net
      // saving wins (the cheapest quality that beats may save far less than a
      // dearer one: common Bone gloves +1% against rare +13%).
      const bestQuality=(kind,base,tiers)=>tiers.map(r=>base+r*data.rarityScale)
        .filter(id=>rate(p,style,ctx,slot,id)>floor)
        .map(id=>priced(kind,id,`换 ${itemLabel(data,id)}`,acquire(p,id,coinRate))).filter(Boolean)
        .sort((a,b)=>b.net-a.net)[0]??null;
      // Enhance the worn piece: the best stopping point up to +5.
      if(autoUsableMaterial(data,current)&&plusOf(data,current)<ENHANCEMENT_BASELINE) {
        let best=null;
        for(let to=plusOf(data,current)+1;to<=ENHANCEMENT_BASELINE;to++) {
          const cost=expectedEnhancement(data,planner,p,current,to),target=current%data.plusScale+to*data.plusScale;
          const after=rate(p,style,ctx,slot,target);
          if(!(after>floor)||!Number.isFinite(cost.gold))continue;
          const gold=cost.gold+cost.shards*shardValue,use=useSeconds(target,after);
          const result=payback({gold,coinRate,before,after,useSeconds:use});
          if(!best||result.net>best.net)best={slot,kind:'enhance',id:target,current,toPlus:to,source:null,
            label:`强化 ${itemLabel(data,current)} → +${to}`,gold:Math.round(gold),coins:Math.round(cost.gold),shards:Math.ceil(cost.shards),
            seconds:0,gain:after/before-1,useSeconds:use,...result};
        }
        if(best)rows.push(best);
      }
      // A higher quality of the same piece.
      const higher=Array.from({length:Math.max(0,LEGENDARY-rarityOf(data,current)-1)},(_,i)=>rarityOf(data,current)+1+i);
      const quality=bestQuality('quality',baseId(data,current),higher);
      if(quality)rows.push(quality);
      // Another piece wearable now, in its quality with the best net saving.
      const others=data.gear.filter(g=>g.itemId!==baseId(data,current)&&fits(g.itemId)&&canWear(data,lv,g.itemId))
        .map(g=>bestQuality('tier',g.itemId,[0,1,2,3])).filter(Boolean).sort((a,b)=>b.net-a.net).slice(0,2);
      rows.push(...others);
      if(ownedIds.length)add('owned',ownedIds[0],`换 ${itemLabel(data,ownedIds[0])}`,{gold:0,seconds:0,source:'已持有'});
    }
    for(const row of rows)row.cheapest=row.worth&&!rows.some(o=>o!==row&&o.slot===row.slot&&o.worth&&o.net>row.net);
    return rows.sort((a,b)=>b.net-a.net);
  }
  function options(p,style,goal=null) {
    const key=JSON.stringify([p.id,style,p.equipment,lvOf(p),goal?.skill??null,goal?.recipeId??null,goal?.monsterId??null,p.route?.jobId??null,p.route?.zoneId??null]);
    if(cache?.key!==key||!(p.lastTick-cache.tick<CACHE_SECONDS*1000/data.tickMs)||p.lastTick<cache.tick)
      cache={key,tick:p.lastTick,rows:compute(p,style,goal)};
    return cache.rows.map(row=>({...row,affordable:row.gold<=p.coins}));
  }
  const fundingKey=row=>`${row.kind}:${row.id}`;
  // A worthwhile improvement that is not yet affordable: earn the gold first on
  // the best gold job, for at most an hour, then return to levelling. A stretch
  // that ends short leaves that improvement alone for six hours.
  function fundingGoal(p,style,deferred={},goal=null) {
    const row=options(p,style,goal).find(r=>r.cheapest&&!r.affordable&&r.gold>0&&
      !(fundingDeferred[fundingKey(r)]>p.lastTick));
    if(!row)return null;
    // Earned on the job that sets the gold rate (the gold table's top lasting
    // row), the rate that priced the payback; the next lasting row when that
    // skill is set aside. Its sale items go with it, so the income is real.
    const candidates=planner.candidates(p,style,deferred);
    const match=r=>candidates.find(c=>!c.rarity&&(r.monsterId!=null?c.monsterId===r.monsterId:c.recipeId===r.recipeId));
    const income=(planner.incomeRows?.(p,style)??[]).filter(r=>!r.oneOff&&r.coins>0).map(r=>[r,match(r)]).find(([,c])=>c);
    const choice=income?{...income[1],saleItems:income[0].saleItems}:null;
    if(!choice)return null;
    const ticks=Math.ceil(FUNDING_CAP_SECONDS*1000/data.tickMs);
    return {...choice,target:planner.thresholds.length,funding:{key:fundingKey(row),gold:row.gold,label:row.label,until:p.lastTick+ticks},
      budget:{...choice.budget,coins:Math.max(choice.budget?.coins??0,row.gold)},horizon:FUNDING_CAP_SECONDS,
      reason:`筹资：${row.label} 约 ${row.gold.toLocaleString()} 金币（含失败重来），按 ${Math.round(row.useSeconds/3600)} 小时使用期可省约 `+
        `${(row.saved/3600).toFixed(1)} 小时，赚这笔钱约 ${(row.paid/3600).toFixed(1)} 小时；先做金币最高的工作，最多 1 小时，再回到练级`};
  }
  function fundingEnded(p,goal) {
    if(goal?.funding&&p.coins<goal.funding.gold)
      fundingDeferred[goal.funding.key]=p.lastTick+Math.ceil(FUNDING_RETRY_SECONDS*1000/data.tickMs);
  }
  function runtime(value) {
    if(value){cache=value.cache??null;fundingDeferred=value.fundingDeferred??{};}
    return {cache,fundingDeferred};
  }
  return {options,fundingGoal,fundingEnded,runtime};
}
