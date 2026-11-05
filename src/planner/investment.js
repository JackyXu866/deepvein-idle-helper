import {ENHANCEMENT_MAX, enhanceQuote} from './inventory.js';
import {formulaWork, luckGold} from './rates.js';
import {canWear, professionSkill} from './professions.js';
import {LEGENDARY, autoUsableMaterial, craftRecipe} from './quality.js';
import {baseId, baseStride, heldIds, itemLabel, plusOf, rarityOf} from './items.js';
import {goldToSeconds, incomePayback, payback, pays, secondsToGold} from './gold.js';
import {isMount, mountSupply} from './mounts.js';
import {harvestCrops} from './farming.js';
import {COMBAT_SLOTS, USE_CAP_SECONDS, fitsSlot, shieldless, useSeconds as sharedUseSeconds} from './gear.js';
export {USE_CAP_SECONDS} from './gear.js';

// A funding stretch on the best gold job lasts at most this long.
export const FUNDING_CAP_SECONDS=3600;
const FUNDING_RETRY_SECONDS=6*3600,CACHE_SECONDS=60;

// Expected gold and shards to take an item from its current +N to `toPlus`.
// A failed attempt resets it to +0, so step k costs (g + (1-s)·E_k)/s, where
// E_k is the expected cost of rebuilding +k from +0 (client 1.0.1189 odds).
export function expectedEnhancement(data,planner,p,itemId,toPlus) {
  return enhancementLadder(data,planner,p,itemId,toPlus)[toPlus]??{gold:0,shards:0};
}
// The same expected cost to every +k from the item's +N up to `toMax`, in one
// pass (index k; below the item's +N, nothing): what the table reads.
export function enhancementLadder(data,planner,p,itemId,toMax=ENHANCEMENT_MAX) {
  const base=itemId%data.plusScale,from=plusOf(data,itemId),out=[];
  let gold=0,shards=0,fromGold=0,fromShards=0;
  for(let k=0;k<toMax;k++) {
    const quote=enhanceQuote(data,planner,p,base+k*data.plusScale),s=quote.chance;
    if(!(s>0)){for(let j=Math.max(k,from)+1;j<=toMax;j++)out[j]={gold:Infinity,shards:Infinity};break;}
    gold+=(quote.gold+(1-s)*gold)/s;shards+=(quote.shards+(1-s)*shards)/s;
    if(k+1===from){fromGold=gold;fromShards=shards;}
    if(k+1>from)out[k+1]={gold:gold-fromGold,shards:shards-fromShards};
  }
  return out;
}

export function createInvestments(data,planner) {
  let cache=null,fundingDeferred={};
  const contextCache=new Map();
  const lvOf=p=>planner.levels(p);
  // The account's measured work (planner.perkUsage, as the mastery choice
  // reads it): seconds per route, by skill ('combat' for fights).
  function measured() {
    return Object.entries(planner.perkUsage??{}).filter(([,m])=>m?.seconds>0).map(([key,m])=>{
      const id=Number(key.split(':')[1]),combat=key.startsWith('combat:');
      return {id,combat,skill:combat?'combat':data.jobs.find(j=>j.id===id)?.skill,seconds:m.seconds,travel:m.travelSeconds??0};
    }).filter(r=>r.skill).sort((a,b)=>b.seconds-a.seconds);
  }
  // What each slot is used for: the monster fought, or the job its tool
  // serves — what the account actually does most (measured), else the route
  // under way, else the best by formula. Not the goal: the plan tab, the gear
  // step, maintenance and funding all read one table.
  function contexts(p,style) {
    const key=JSON.stringify([p.id,p.lastTick,style,p.equipment,lvOf(p),p.route?.jobId??null,p.route?.zoneId??null]);
    if(contextCache.has(key))return contextCache.get(key);
    const skill=professionSkill(style),lv=lvOf(p),work=measured();
    const safe=(planner.combatOptions?.(p,style)??[]).map(c=>c.monster);
    const monster=safe.find(m=>m.id===work.find(r=>r.combat&&safe.some(s=>s.id===r.id))?.id)??
      data.monsters.find(m=>m.id===data.zones.find(z=>z.id===p.route?.zoneId)?.monsterId)??
      [...safe].sort((a,b)=>(planner.combatChoice?.(p,style,b)?.score??0)-(planner.combatChoice?.(p,style,a)?.score??0))[0]??null;
    const usable=j=>!j.grow&&lv[j.skill]>=j.levelReq&&data.sites.some(s=>s.jobIds.includes(j.id));
    const jobFor=toolSkill=>data.jobs.find(j=>j.id===work.find(r=>!r.combat&&r.skill===toolSkill&&usable(data.jobs.find(x=>x.id===r.id)))?.id)??
      data.jobs.find(j=>j.id===p.route?.jobId&&j.skill===toolSkill)??
      data.jobs.filter(j=>j.skill===toolSkill&&usable(j))
        .sort((a,b)=>{const r=j=>{const e=formulaWork(data,planner,p,j,lv);return e.xp/e.seconds;};return r(b)-r(a);})[0]??null;
    const ctx={skill,monster,jobFor,rates:new Map()};
    if(contextCache.size>=8)contextCache.delete(contextCache.keys().next().value);
    contextCache.set(key,ctx);
    return ctx;
  }
  // A hoe's slot (client 1.0.1202): the farm fields' gold per second (its
  // bonus is extra crops per harvest, at their sale value) and the farming XP
  // per second they give (which sets how long the hoe is used).
  function farmRates(p,id) {
    const bonus=planner.equipmentStats(id)?.bonus??0,lv=lvOf(p).farming;
    let gold=0,xp=0;
    for(const {job,rarity} of planner.farmCrops?.(p)??[]) {
      const seconds=job.grow*data.tickMs/1000;
      gold+=harvestCrops(lv,bonus)*planner.saleValue(p,job.output.itemId+rarity*data.rarityScale,1)/seconds;
      xp+=job.xp/seconds;
    }
    return {gold,xp};
  }
  // A mount speeds every walk: the share of the account's measured time spent
  // walking (telemetry travelSeconds), at the mount's stride against the worn
  // one's. Relative: the worn mount is 1; a faster one cuts the walking part.
  function mountRate(p,id) {
    const work=measured(),total=work.reduce((n,r)=>n+r.seconds,0),walking=total>0?work.reduce((n,r)=>n+r.travel,0)/total:0;
    const stride=mount=>baseStride(data,{...p,equipment:{...p.equipment,mount}});
    return 1/((1-walking)+walking*stride(p.equipment?.mount??null)/stride(id));
  }
  // XP per second with `slot` holding `id`, by the game formulas on both sides
  // of a swap (a measurement only exists for the current equipment). Combat
  // counts the food each kill costs, so defence is worth something. A hoe:
  // the fields' gold per second (farmRates).
  function rate(p,style,ctx,slot,id) {
    const key=`${slot}:${id}`;
    if(ctx.rates.has(key))return ctx.rates.get(key);
    const equipment={...p.equipment,[slot]:id},toolSkill=data.toolSkills[slot];
    let value=0;
    if(slot==='hoe')value=farmRates(p,id).gold;
    else if(slot==='mount')value=mountRate(p,id);
    else if(toolSkill) {
      const job=ctx.jobFor(toolSkill);
      // Per action with its walking (bank trips): a faster tool shortens only the work.
      if(job){const e=formulaWork(data,planner,p,job,lvOf(p),equipment);value=e.xp/(e.seconds+(planner.walkPerAction?.(p,job)??0));}
    } else if(ctx.monster) {
      // Every piece is rated with the food the worn gear's fight uses.
      ctx.food??=planner.byFormula(()=>planner.combatFood?.(p,style,ctx.monster.id)??0);
      value=planner.byFormula(()=>planner.combatRate(p,style,ctx.monster.id,equipment,ctx.food));
    }
    ctx.rates.set(key,value);
    return value;
  }
  // The account's work for luck: measured routes by share (the five largest),
  // else the fight or job each slot is rated on.
  function luckWorks(ctx) {
    const work=measured().slice(0,5),total=work.reduce((n,r)=>n+r.seconds,0);
    const rows=work.map(r=>({share:r.seconds/total,work:r.combat?{monster:data.monsters.find(m=>m.id===r.id)}:{job:data.jobs.find(j=>j.id===r.id)}}))
      .filter(r=>r.work.monster||r.work.job);
    return rows.length?rows:ctx.monster?[{share:1,work:{monster:ctx.monster}}]:[];
  }
  // What a piece gives, in two parts: `speed`, its rate (XP/s; a hoe's gold;
  // an amulet's defence relative to none, weighted by the fight share), and
  // `luck`, the gold per second its luck adds in rarer qualities (rates.js
  // luckGold): a tool's in its job, an amulet's across the account's work.
  function parts(p,style,ctx,slot,id) {
    const key=`parts:${slot}:${id}`;
    if(ctx.rates.has(key))return ctx.rates.get(key);
    const equipment={...p.equipment,[slot]:id};
    const luck=work=>work?Math.max(0,luckGold(data,planner,p,{...work,equipment,profession:style})):0;
    const value=rate(p,style,ctx,slot,id);
    let result={speed:value,luck:0};
    if(slot==='amulet') {
      const none=rate(p,style,ctx,slot,null),fight=shareOf(p,style)('combat');
      result={speed:none>0?1+fight*(value/none-1):1,luck:luckWorks(ctx).reduce((n,r)=>n+r.share*luck(r.work),0)};
    } else if(data.toolSkills[slot]&&slot!=='hoe') {
      const job=ctx.jobFor(data.toolSkills[slot]);
      result={speed:value,luck:job?luck({job}):0};
    }
    ctx.rates.set(key,result);
    return result;
  }
  // The one index the whole table ranks pieces by: speed x (1 + luck's gold as
  // time at the gold rate).
  function worth(p,style,ctx,slot,id) {
    const coinRate=planner.coinRate?.(p)??0,{speed,luck}=parts(p,style,ctx,slot,id);
    return speed*(1+(coinRate>0?luck/coinRate:0));
  }
  // What wearing `id` instead of `current` repays over `use` seconds: the time
  // its speed saves (payback, or a hoe's extra gold) plus, in full, the extra
  // gold its luck brings, as time at the gold rate. (Folding luck into the
  // speed ratio undervalued it: a gain L counted as L/(1+L).)
  function settleGear(p,style,ctx,slot,current,id,{gold=0,seconds=0},use) {
    const coinRate=planner.coinRate?.(p)??0,settle=slot==='hoe'?incomePayback:payback;
    const a=parts(p,style,ctx,slot,current),b=parts(p,style,ctx,slot,id);
    const r=settle({gold,seconds,coinRate,before:a.speed,after:b.speed,useSeconds:use});
    const luck=coinRate>0&&b.luck>a.luck?(b.luck-a.luck)*use/coinRate:0;
    return luck?{...r,saved:r.saved+luck,net:r.net+luck,worth:pays(r.saved+luck,r.paid)}:r;
  }
  // An amulet's luck works in everything the account does; a hoe in all of it too.
  // So do a mount (its rate already weighs the walking share) and a hoe.
  const usedShare=(slot,share)=>slot==='hoe'||slot==='amulet'||slot==='mount'?1:share(data.toolSkills[slot]??'combat');
  const gearRate=(p,style,goal,slot,id)=>worth(p,style,contexts(p,style),slot,id);
  const gearXpRate=(p,style,goal,slot,id)=>rate(p,style,contexts(p,style),slot,id);
  const fitsFor=(p,style,ctx,slot)=>{
    const useSkill=data.toolSkills[slot]??ctx.skill,lv=lvOf(p);
    return id=>fitsSlot(planner.equipmentStats(id),slot,useSkill,style)&&canWear(data,lv,id);
  };
  // The best piece held for a slot, by the rate (ties by stats: an amulet's
  // luck, a hoe); null when nothing held beats what is worn. Owned swaps and
  // the table's 已持有 row are this one rule.
  function ownedBest(p,style,goal,slot) {
    const ctx=contexts(p,style),fits=fitsFor(p,style,ctx,slot),current=p.equipment[slot];
    const useSkill=data.toolSkills[slot]??ctx.skill,score=id=>planner.gearScore(id,useSkill),r=id=>worth(p,style,ctx,slot,id);
    const worn=new Set(Object.values(p.equipment).filter(Number.isFinite));
    const best=heldIds(p).filter(id=>!worn.has(id)&&fits(id)).sort((a,b)=>r(b)-r(a)||score(b)-score(a)||b-a)[0];
    if(best==null)return null;
    if(current!=null&&fits(current)&&(r(best)<r(current)||r(best)===r(current)&&score(best)<=score(current)))return null;
    return best;
  }

  // Cheapest way to get an item: owned, made or bought. Made by the shared
  // input cost (input-cost.js), as every recipe is priced: the work and
  // getting its inputs (held ones at their sale value, bought ones at their
  // price, as time), less the XP it earns in trained skills at their best rate.
  function acquire(p,id,coinRate) {
    if(planner.count(p,id)>0)return {gold:0,seconds:0,source:'已持有'};
    // A mount: held lower mounts, the merchant's horse, the market, or bred
    // from ten of the quality below, whichever is cheapest at each step (mounts.js).
    if(isMount(data,id)&&!plusOf(data,id)) {
      const supply=mountSupply(data,planner,p,id,1,coinRate);
      return Number.isFinite(supply.gold)?{gold:supply.gold,seconds:supply.seconds,source:supply.source,supply}:null;
    }
    const options=[];
    const original=data.jobs.find(j=>j.output.itemId===baseId(data,id)&&j.inputs.length&&!j.grow);
    const recipe=original&&id<data.plusScale&&(rarityOf(data,id)>0?craftRecipe(data,original,rarityOf(data,id)):original);
    if(recipe&&lvOf(p)[recipe.skill]>=recipe.levelReq&&planner.inputCost) {
      // Plus the walking the route adds (to the mine, the furnace, the anvil):
      // the input cost counts the work only, which made a Bronze hoe look free.
      const made=planner.inputCost.make(p,recipe,1),route=planner.routeEstimate(p,recipe,1,{});
      const travel=Number.isFinite(route.seconds)?Math.max(0,route.seconds-made.seconds):0;
      if(Number.isFinite(made.effective))options.push({gold:0,seconds:made.effective+travel,source:'自制'});
    }
    const ask=planner.marketAsk?.(p,id);
    if(ask>0)options.push({gold:ask,seconds:0,source:'市场'});
    const cost=o=>o.seconds+goldToSeconds(o.gold,coinRate);
    return options.sort((a,b)=>cost(a)-cost(b))[0]??null;
  }
  // The share of the account's time each skill takes ('combat' for fights),
  // from the measured routes the mastery choice reads (planner.perkUsage): a
  // piece saves time only while its slot is in use, so a pickaxe for a miner
  // who never mines saves nothing. Without measurements, the XP earned in
  // each skill stands in for the time spent there (the combat style's XP for
  // fights).
  function shareOf(p,style) {
    const sums={};let total=0;
    for(const r of measured()){sums[r.skill]=(sums[r.skill]??0)+r.seconds;total+=r.seconds;}
    if(!(total>0)) {
      const fight=professionSkill(style);
      for(const skill of data.skills.filter(s=>!['melee','ranged','magic','defence','hitpoints'].includes(s)||s===fight)) {
        const xp=Math.max(0,p.skills?.[skill]??0),key=skill===fight?'combat':skill;
        sums[key]=(sums[key]??0)+xp;total+=xp;
      }
    }
    return skill=>total>0?(sums[skill]??0)/total:1;
  }
  function slotsFor(p,style) {
    const twoHanded=shieldless(style,planner.equipmentStats(p.equipment.weapon));
    return [...COMBAT_SLOTS.filter(s=>s!=='shield'||!twoHanded),
      ...Object.keys(data.toolSkills).filter(s=>planner.trainedSkills(style).includes(data.toolSkills[s])),'mount'];
  }
  // Every worthwhile way to improve each worn piece, on the same terms.
  function compute(p,style,goal) {
    const ctx=contexts(p,style),coinRate=planner.coinRate?.(p)??0,rows=[],share=shareOf(p,style);
    const shardValue=(planner.stockValue??planner.saleValue)(p,data.shardId,1);
    for(const slot of slotsFor(p,style)) {
      const current=p.equipment[slot]??null,worn=planner.equipmentStats(current);
      // A hoe is used until outgrown at the fields' farming XP, and repays in
      // extra gold (incomePayback); every other piece in time saved. An empty
      // slot is improved by filling it, on the same terms.
      const hoe=slot==='hoe';
      // Used until outgrown, within 30 days of the account's time in that work
      // (the fields grow whatever is done, so a hoe counts all of it).
      const used=usedShare(slot,share);
      // How long a piece lasts: until outgrown at its XP rate (a hoe: the fields' farming XP).
      const useSkill=data.toolSkills[slot]??ctx.skill,useSeconds=id=>
        Math.min(sharedUseSeconds(data,planner,p,id,slot,hoe?farmRates(p,id).xp:rate(p,style,ctx,slot,id),useSkill),USE_CAP_SECONDS*used);
      const fits=fitsFor(p,style,ctx,slot);
      if(worn&&!fitsSlot(worn,slot,useSkill,style))continue;
      const before=worth(p,style,ctx,slot,current);
      if(!(before>0))continue;
      // The best piece already in the bank or pack, of any quality (wearing
      // keeps a legendary piece with the player): the same rule the owned swap
      // uses. Nothing is bought or made that is no better than it.
      const owned=ownedBest(p,style,goal,slot);
      const floor=owned!=null?Math.max(before,worth(p,style,ctx,slot,owned)):before;
      const priced=(kind,id,label,cost,extra={})=>{
        if(!cost)return null;
        const after=worth(p,style,ctx,slot,id);
        if(!(after>before))return null;
        const use=useSeconds(id),result=settleGear(p,style,ctx,slot,current,id,cost,use);
        return {slot,kind,id,label,current,source:cost.source??null,gold:Math.round(cost.gold),seconds:cost.seconds,
          gain:after/before-1,useSeconds:use,...result,...extra};
      };
      const add=(...args)=>{const row=priced(...args);if(row)rows.push(row);};
      // Every quality of a piece that beats the floor, priced; the best net
      // saving wins (the cheapest quality that beats may save far less than a
      // dearer one: common Bone gloves +1% against rare +13%).
      // Enhanced copies (+1..+20) on the market count too: the buy step buys
      // only what this table priced.
      const bestQuality=(kind,base,tiers)=>tiers.flatMap(r=>Array.from({length:ENHANCEMENT_MAX+1},
        (_,plus)=>base+r*data.rarityScale+plus*data.plusScale))
        .map(id=>{
          if(!plusOf(data,id))return [id,acquire(p,id,coinRate)];
          const ask=planner.marketAsk?.(p,id);
          return [id,ask>0?{gold:ask,seconds:0,source:'市场'}:null];
        }).filter(([id,cost])=>cost&&worth(p,style,ctx,slot,id)>floor)
        .map(([id,cost])=>priced(kind,id,`换 ${itemLabel(data,id)}`,cost)).filter(Boolean)
        .sort((a,b)=>b.net-a.net)[0]??null;
      // Enhance the worn piece, any quality (a legendary one stays worn): the
      // best stopping point up to the game's +20. A failure never destroys the
      // piece; it goes back to +0, which the expected cost counts.
      if(current!=null&&plusOf(data,current)<ENHANCEMENT_MAX) {
        let best=null;
        const ladder=enhancementLadder(data,planner,p,current);
        for(let to=plusOf(data,current)+1;to<=ENHANCEMENT_MAX;to++) {
          const cost=ladder[to],target=current%data.plusScale+to*data.plusScale;
          const after=worth(p,style,ctx,slot,target);
          if(!(after>floor)||!Number.isFinite(cost.gold))continue;
          const gold=cost.gold+cost.shards*shardValue,use=useSeconds(target);
          const result=settleGear(p,style,ctx,slot,current,target,{gold},use);
          if(!best||result.net>best.net)best={slot,kind:'enhance',id:target,current,toPlus:to,source:null,
            label:`强化 ${itemLabel(data,current)} → +${to}`,gold:Math.round(gold),coins:Math.round(cost.gold),shards:Math.ceil(cost.shards),
            seconds:0,gain:after/before-1,useSeconds:use,...result};
        }
        if(best)rows.push(best);
      }
      // A better copy of the same piece: a higher quality, or the same quality
      // at a higher +N on sale (only copies that beat the worn one survive).
      // A mount's qualities run to legendary: bought or bred, it is worn
      // (legendary stays the player's), never sold or used up.
      const top=slot==='mount'?LEGENDARY:LEGENDARY-1,upTo=from=>Array.from({length:Math.max(0,top+1-from)},(_,i)=>from+i);
      if(current!=null) {
        const quality=bestQuality('quality',baseId(data,current),upTo(rarityOf(data,current)));
        if(quality)rows.push(quality);
      }
      // Another piece wearable now, in its quality with the best net saving.
      const others=data.gear.filter(g=>(current==null||g.itemId!==baseId(data,current))&&fits(g.itemId))
        .map(g=>bestQuality('tier',g.itemId,upTo(0))).filter(Boolean).sort((a,b)=>b.net-a.net).slice(0,2);
      rows.push(...others);
      // A mount to get and then enhance, as one option: a held copy (its
      // highest +N), else +0 the cheapest way (bought, from the merchant, or
      // bred: acquire), enhanced to the best +k by the expected cost. A
      // legendary +0 (x5) is slower than an epic +5 (x6.1); +2 beats it.
      // Enhanced in the bank, it is put on once it beats the worn one (ownedBest).
      if(slot==='mount') {
        const wornNow=new Set(Object.values(p.equipment).filter(Number.isFinite));
        let best=null;
        for(const g of data.gear.filter(g=>g.slot==='mount'&&fits(g.itemId)))for(const tier of upTo(0)) {
          const plain=g.itemId+tier*data.rarityScale;
          const held=heldIds(p).filter(id=>id%data.plusScale===plain&&!wornNow.has(id)).sort((a,b)=>b-a)[0];
          const start=held??plain,cost=held!=null?{gold:0,seconds:0,source:'已持有'}:acquire(p,plain,coinRate);
          if(!cost||plusOf(data,start)>=ENHANCEMENT_MAX)continue;
          const ladder=enhancementLadder(data,planner,p,start);
          for(let to=plusOf(data,start)+1;to<=ENHANCEMENT_MAX;to++) {
            const step=ladder[to],target=plain+to*data.plusScale;
            if(!Number.isFinite(step?.gold)||!(worth(p,style,ctx,slot,target)>floor))continue;
            const enhanceGold=step.gold+step.shards*shardValue,gold=cost.gold+enhanceGold;
            const row=priced('acquireEnhance',target,`${cost.source==='已持有'?'强化':`${cost.source} `}${itemLabel(data,start)} → +${to}`,
              {gold,seconds:cost.seconds,source:cost.source},{start,toPlus:to,acquireGold:Math.round(cost.gold),
                coins:Math.round(step.gold),shards:Math.ceil(step.shards),supply:cost.supply??null});
            if(row&&(!best||row.net>best.net))best=row;
          }
        }
        if(best)rows.push(best);
      }
      if(owned!=null) {
        // Free and one bank trip: put on even when the formulas see no gain
        // (an amulet's luck), as the owned swap does.
        const row=priced('owned',owned,`换 ${itemLabel(data,owned)}`,{gold:0,seconds:0,source:'已持有'});
        rows.push(row?{...row,worth:true}:{slot,kind:'owned',id:owned,label:`换 ${itemLabel(data,owned)}`,current,source:'已持有',gold:0,seconds:0,
          gain:0,useSeconds:useSeconds(owned),paid:0,saved:0,net:0,worth:true});
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
  // The time wearing `id` in place of the worn piece in `slot` saves over its
  // use, as the table counts it (an enhance row's `saved`); 0 for a slot the
  // profession does not use or no gain.
  function savingOf(p,style,slot,id) {
    const current=p.equipment?.[slot]??null;
    if(current==null||!slotsFor(p,style).includes(slot))return 0;
    const ctx=contexts(p,style),coinRate=planner.coinRate?.(p)??0,share=shareOf(p,style);
    const hoe=slot==='hoe',used=usedShare(slot,share);
    const useSkill=data.toolSkills[slot]??ctx.skill;
    const before=worth(p,style,ctx,slot,current),after=worth(p,style,ctx,slot,id);
    if(!(before>0)||!(after>before))return 0;
    const use=Math.min(sharedUseSeconds(data,planner,p,id,slot,hoe?farmRates(p,id).xp:rate(p,style,ctx,slot,id),useSkill),USE_CAP_SECONDS*used);
    return settleGear(p,style,ctx,slot,current,id,{},use).saved;
  }
  // The cheapest way to get `id` (held, made or bought), as gold at the gold rate.
  function acquireGold(p,id) {
    const coinRate=planner.coinRate?.(p)??0,cost=acquire(p,id,coinRate);
    return cost?{gold:cost.gold+secondsToGold(cost.seconds,coinRate),source:cost.source,ask:cost.source==='市场'?cost.gold:null}:null;
  }
  let computing=false;
  function options(p,style,goal=null) {
    // The goal adds only its gear project's row.
    const key=JSON.stringify([p.id,style,p.equipment,lvOf(p),goal?.upgrade?.slot??null,goal?.upgrade?.id??null,p.route?.jobId??null,p.route?.zoneId??null]);
    // Pricing a row can reach code that asks for the planned gear (held
    // materials), which reads this table: that inner ask sees no rows.
    if(computing)return [];
    // A few states at once (the plan's goal, the planned gear's none), each
    // fresh for a minute. An older runtime carried one entry.
    const kept=(Array.isArray(cache)?cache:cache?[cache]:[]).filter(e=>e.tick<=p.lastTick&&p.lastTick-e.tick<CACHE_SECONDS*1000/data.tickMs);
    let entry=kept.find(e=>e.key===key);
    if(!entry) {
      computing=true;
      try {entry={key,tick:p.lastTick,rows:compute(p,style,goal)};} finally {computing=false;}
      cache=[entry,...kept].slice(0,4);
    }
    return entry.rows.map(row=>({...row,affordable:row.gold<=p.coins,project:goal?.upgrade?.slot===row.slot&&goal.upgrade.id===row.id}));
  }
  const fundingKey=row=>`${row.kind}:${row.id}`;
  // How gold is earned whenever gold is needed (funding, a plan short of
  // cash): the job that sets the gold rate (the gold table's top lasting row,
  // the rate every payback is priced at); the next lasting row when that skill
  // is set aside. Its sale items go with it, so the income is real.
  function earningGoal(p,style,deferred={}) {
    const candidates=planner.candidates(p,style,deferred);
    const match=r=>candidates.find(c=>!c.rarity&&(r.monsterId!=null?c.monsterId===r.monsterId:c.recipeId===r.recipeId));
    const income=(planner.incomeRows?.(p,style)??[]).filter(r=>!r.oneOff&&r.coins>0).map(r=>[r,match(r)]).find(([,c])=>c);
    return income?{...income[1],saleItems:income[0].saleItems,coinsPerHour:Math.round(income[0].coins*3600)}:null;
  }
  // A worthwhile improvement that is not yet affordable: earn the gold first on
  // the best gold job, for at most an hour, then return to levelling. A stretch
  // that ends short leaves that improvement alone for six hours.
  function fundingGoal(p,style,deferred={},goal=null) {
    const row=options(p,style,goal).find(r=>r.cheapest&&!r.affordable&&r.gold>0&&
      !(fundingDeferred[fundingKey(r)]>p.lastTick));
    if(!row)return null;
    const choice=earningGoal(p,style,deferred);
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
  return {options,fundingGoal,fundingEnded,runtime,gearRate,gearXpRate,shareOf,ownedBest,earningGoal,savingOf,acquireGold};
}
