import {ENHANCEMENT_BASELINE, enhanceQuote} from './inventory.js';
import {formulaWork} from './rates.js';
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
  const contextCache=new Map();
  const lvOf=p=>planner.levels(p);
  // What each slot is used for: the monster being fought, or the job its tool
  // serves. One per state, shared by the table and every gear decision.
  function contexts(p,style,goal) {
    const key=JSON.stringify([p.id,p.lastTick,style,p.equipment,lvOf(p),goal?.skill??null,goal?.recipeId??null,goal?.recipes??null,
      goal?.monsterId??null,p.route?.jobId??null,p.route?.zoneId??null]);
    if(contextCache.has(key))return contextCache.get(key);
    const skill=professionSkill(style),lv=lvOf(p);
    const monster=data.monsters.find(m=>m.id===(goal?.monsterId??data.zones.find(z=>z.id===p.route?.zoneId)?.monsterId))??
      (planner.combatOptions?.(p,style)??[]).map(c=>c.monster)
        .sort((a,b)=>planner.combatRate(p,style,b.id)-planner.combatRate(p,style,a.id))[0]??null;
    const jobFor=toolSkill=>data.jobs.find(j=>j.id===(goal?.recipes?.[toolSkill]??(goal?.skill===toolSkill?goal.recipeId:null)))??
      data.jobs.find(j=>j.id===p.route?.jobId&&j.skill===toolSkill)??
      data.jobs.filter(j=>j.skill===toolSkill&&!j.grow&&lv[toolSkill]>=j.levelReq&&data.sites.some(s=>s.jobIds.includes(j.id)))
        .sort((a,b)=>{const r=j=>{const e=formulaWork(data,planner,p,j,lv);return e.xp/e.seconds;};return r(b)-r(a);})[0]??null;
    const ctx={skill,monster,jobFor,rates:new Map()};
    // A few states at once: the plan, the table and the gear targets ask with different goals.
    if(contextCache.size>=8)contextCache.delete(contextCache.keys().next().value);
    contextCache.set(key,ctx);
    return ctx;
  }
  // XP per second with `slot` holding `id`, by the game formulas on both sides
  // of a swap (a measurement only exists for the current equipment). Combat
  // counts the food each kill costs, so defence is worth something.
  function rate(p,style,ctx,slot,id) {
    const key=`${slot}:${id}`;
    if(ctx.rates.has(key))return ctx.rates.get(key);
    const equipment={...p.equipment,[slot]:id},toolSkill=data.toolSkills[slot];
    let value=0;
    if(toolSkill) {
      const job=ctx.jobFor(toolSkill);
      if(job){const e=formulaWork(data,planner,p,job,lvOf(p),equipment);value=e.xp/e.seconds;}
    } else if(ctx.monster) value=planner.combatRate(p,style,ctx.monster.id,equipment);
    ctx.rates.set(key,value);
    return value;
  }
  const gearRate=(p,style,goal,slot,id)=>rate(p,style,contexts(p,style,goal),slot,id);
  const fitsFor=(p,style,ctx,slot)=>{
    const useSkill=data.toolSkills[slot]??ctx.skill,lv=lvOf(p);
    return id=>fitsSlot(planner.equipmentStats(id),slot,useSkill,style)&&canWear(data,lv,id);
  };
  // The best piece held for a slot, by the rate (ties by stats: an amulet's
  // luck, a hoe); null when nothing held beats what is worn. Owned swaps and
  // the table's 已持有 row are this one rule.
  function ownedBest(p,style,goal,slot) {
    const ctx=contexts(p,style,goal),fits=fitsFor(p,style,ctx,slot),current=p.equipment[slot];
    const useSkill=data.toolSkills[slot]??ctx.skill,score=id=>planner.gearScore(id,useSkill),r=id=>rate(p,style,ctx,slot,id);
    const worn=new Set(Object.values(p.equipment).filter(Number.isFinite));
    const best=heldIds(p).filter(id=>!worn.has(id)&&fits(id)).sort((a,b)=>r(b)-r(a)||score(b)-score(a)||b-a)[0];
    if(best==null)return null;
    if(current!=null&&fits(current)&&(r(best)<r(current)||r(best)===r(current)&&score(best)<=score(current)))return null;
    return best;
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
    const ctx=contexts(p,style,goal),coinRate=planner.coinRate?.(p)??0,rows=[];
    const shardValue=planner.saleValue(p,data.shardId,1);
    for(const slot of slotsFor(p,style)) {
      const current=p.equipment[slot],worn=planner.equipmentStats(current);
      if(!worn||slot==='mount')continue;
      const useSkill=data.toolSkills[slot]??ctx.skill,useSeconds=(id,rate)=>sharedUseSeconds(data,planner,p,id,slot,rate,useSkill);
      const fits=fitsFor(p,style,ctx,slot);
      if(!fitsSlot(worn,slot,useSkill,style))continue;
      const before=rate(p,style,ctx,slot,current);
      if(!(before>0))continue;
      // The best piece already in the bank or pack, of any quality (wearing
      // keeps a legendary piece with the player): the same rule the owned swap
      // uses. Nothing is bought or made that is no better than it.
      const owned=ownedBest(p,style,goal,slot);
      const floor=owned!=null?Math.max(before,rate(p,style,ctx,slot,owned)):before;
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
      // Enhanced copies (+1..+5) on the market count too: the buy step buys
      // only what this table priced.
      const bestQuality=(kind,base,tiers)=>tiers.flatMap(r=>Array.from({length:ENHANCEMENT_BASELINE+1},
        (_,plus)=>base+r*data.rarityScale+plus*data.plusScale))
        .map(id=>{
          if(!plusOf(data,id))return [id,acquire(p,id,coinRate)];
          const ask=planner.marketAsk?.(p,id);
          return [id,ask>0?{gold:ask,seconds:0,source:'市场'}:null];
        }).filter(([id,cost])=>cost&&rate(p,style,ctx,slot,id)>floor)
        .map(([id,cost])=>priced(kind,id,`换 ${itemLabel(data,id)}`,cost)).filter(Boolean)
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
      const others=data.gear.filter(g=>g.itemId!==baseId(data,current)&&fits(g.itemId))
        .map(g=>bestQuality('tier',g.itemId,[0,1,2,3])).filter(Boolean).sort((a,b)=>b.net-a.net).slice(0,2);
      rows.push(...others);
      if(owned!=null) {
        // Free and one bank trip: put on even when the formulas see no gain
        // (an amulet's luck), as the owned swap does.
        const row=priced('owned',owned,`换 ${itemLabel(data,owned)}`,{gold:0,seconds:0,source:'已持有'});
        rows.push(row??{slot,kind:'owned',id:owned,label:`换 ${itemLabel(data,owned)}`,current,source:'已持有',gold:0,seconds:0,
          gain:0,useSeconds:useSeconds(owned,before),paid:0,saved:0,net:0,worth:true});
      }
      // The piece the stage-gear project is making, on the same terms.
      const project=goal?.upgrade?.slot===slot?goal.upgrade.id:null;
      if(project!=null&&!rows.some(r=>r.slot===slot&&r.id===project))
        add('project',project,`阶段装备 ${itemLabel(data,project)}`,acquire(p,project,coinRate));
    }
    // A held piece is put on first (free, one bank trip), so it is the slot's pick.
    for(const row of rows)row.cheapest=row.worth&&(row.kind==='owned'||
      !rows.some(o=>o!==row&&o.slot===row.slot&&(o.kind==='owned'||o.worth&&o.net>row.net)));
    return rows.sort((a,b)=>b.net-a.net);
  }
  function options(p,style,goal=null) {
    const key=JSON.stringify([p.id,style,p.equipment,lvOf(p),goal?.skill??null,goal?.recipeId??null,goal?.recipes??null,goal?.monsterId??null,
      goal?.upgrade?.id??null,p.route?.jobId??null,p.route?.zoneId??null]);
    if(cache?.key!==key||!(p.lastTick-cache.tick<CACHE_SECONDS*1000/data.tickMs)||p.lastTick<cache.tick)
      cache={key,tick:p.lastTick,rows:compute(p,style,goal)};
    return cache.rows.map(row=>({...row,affordable:row.gold<=p.coins,project:goal?.upgrade?.slot===row.slot&&goal.upgrade.id===row.id}));
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
  return {options,fundingGoal,fundingEnded,runtime,gearRate,ownedBest};
}
