import {autoUsableMaterial, craftRecipe} from './quality.js';
import {formulaWork} from './rates.js';
import {lockedGear} from './inventory.js';
import {goldToSeconds} from './gold.js';
import {baseId, distance, packFree, packQty, rarityOf, stockMap, withoutItem} from './items.js';

export function createCrafting(data,planner) {
  // Recipes making each base (any level), found once per data.
  const makers=new Map();
  for(const j of data.jobs)if(j.inputs.length&&!j.grow) {
    if(!makers.has(j.output.itemId))makers.set(j.output.itemId,[]);
    makers.get(j.output.itemId).push(j);
  }
  function estimate(p,id,qty,{reserve={},buy=false,coins=0}={}) {
    const levels=planner.levels(p),locked=lockedGear(data,p);
    // Bank and pack less what is reserved (one of each locked gear piece),
    // read in place: only what this estimate uses is recorded, in `changes`,
    // and a failed branch is undone from the log. Copying the whole bank at
    // every step made this the slowest part of a plan for a large bank.
    const keep=key=>Math.max(reserve[key]??0,locked.ids.has(key)||locked.variants.has(key%data.plusScale)?1:0);
    const changes=new Map(),log=[];
    const get=key=>changes.has(key)?changes.get(key):Math.max(0,(p.bank[key]??0)+packQty(p,key)-keep(key));
    const put=(key,value)=>{log.push([key,changes.has(key),changes.get(key)]);changes.set(key,value);};
    const undo=mark=>{while(log.length>mark){const [key,had,value]=log.pop();if(had)changes.set(key,value);else changes.delete(key);}};
    const stockNow=()=>{
      const out={};
      for(const key of new Set([...Object.keys(p.bank).map(Number),...p.pack.map(i=>i.itemId),...changes.keys()]))out[key]=get(key);
      return out;
    };
    let money=0;
    const rates=new Map(),trips=new Map();
    function supply(itemId,amount,trail=[]) {
      if(!autoUsableMaterial(data,itemId))return Infinity;
      const used=Math.min(amount,get(itemId));put(itemId,get(itemId)-used);
      const missing=amount-used;if(missing<=0)return 0;
      if(trail.includes(itemId)||itemId>=data.plusScale)return Infinity;
      const tier=rarityOf(data,itemId),base=planner.base(itemId);
      const job=(makers.get(base)??[]).find(j=>levels[j.skill]>=j.levelReq);
      const recipe=job&&craftRecipe(data,job,tier);
      if(recipe) {
        const mark=log.length,beforeMoney=money;
        const n=Math.ceil(missing/recipe.output.qty),next=[...trail,itemId];
        let seconds=0;
        for(const input of recipe.inputs)seconds+=supply(input.itemId,n*input.qty,next);
        if(Number.isFinite(seconds)) {
          if(!rates.has(recipe))rates.set(recipe,formulaWork(data,planner,p,recipe,levels));
          const rate=rates.get(recipe);
          put(itemId,get(itemId)+n*recipe.output.qty-missing);
          if(!trips.has(job.id))trips.set(job.id,2*Math.min(...data.sites.filter(site=>site.jobIds.includes(job.id))
            .map(site=>distance(p,site)))*data.tickMs/1000);
          return seconds+n*rate.seconds/rate.success+trips.get(job.id);
        }
        undo(mark);money=beforeMoney;
      }
      if(buy) {
        const unit=itemId===id?Infinity:planner.marketBuyPrice?.(p,itemId,missing)??Infinity;
        const seconds=goldToSeconds(unit*missing,planner.coinRate(p));
        if(Number.isFinite(seconds)){money+=unit*missing;return seconds;}
        // Ordinary missing fuel can be gathered; never grind random rare drops.
        if(tier===0)return planner.routeEstimate({...p,bank:stockNow(),pack:[]},{itemId},missing).seconds;
      }
      return Infinity;
    }
    const seconds=supply(id,qty);
    return {seconds:money>(planner.marketAllowance?.(p,{budget:{coins}})??0)?Infinity:seconds,money,xp:0};
  }
  // For display: walk the same quality chain against current stock and report
  // the materials still missing at its ends (e.g. uncommon cobalt ore), and the
  // crafting levels it needs. Ordinary fuel is left to `estimate`'s gathering.
  function shortfall(p,id,qty) {
    const stock=stockMap(p),levels=planner.levels(p),missing={},requirements=[];
    (function walk(itemId,amount,trail) {
      const used=Math.min(amount,stock[itemId]??0);stock[itemId]=(stock[itemId]??0)-used;
      const left=amount-used;if(left<=0)return;
      const tier=Math.floor(itemId%data.plusScale/data.rarityScale),job=data.jobs.find(j=>j.output.itemId===planner.base(itemId)&&j.inputs.length&&!j.grow);
      const recipe=job&&!trail.includes(itemId)&&craftRecipe(data,job,tier);
      if(!recipe||itemId>=data.plusScale){if(tier>0)missing[itemId]=(missing[itemId]??0)+left;return;}
      if(levels[job.skill]<job.levelReq&&!requirements.some(r=>r.skill===job.skill&&r.target>=job.levelReq))
        requirements.push({skill:job.skill,target:job.levelReq});
      const n=Math.ceil(left/recipe.output.qty);
      for(const input of recipe.inputs)walk(input.itemId,n*input.qty,[...trail,itemId]);
    })(id,qty,[]);
    return {missing,requirements};
  }
  // Crafts of `job` at quality `tier` that owned quality materials support, up
  // to `max` (a batch looks at 50; a whole stage looks further).
  function available(p,job,tier,reserve={},max=50) {
    const recipe=craftRecipe(data,job,tier);if(!recipe)return 0;
    // Output already owned must not count as raw material for another batch.
    const before=withoutItem(p,recipe.output.itemId);
    if(!Number.isFinite(estimate(before,recipe.output.itemId,recipe.output.qty,{reserve}).seconds))return 0;
    let lo=0,hi=max;
    while(lo<hi) {const n=Math.ceil((lo+hi)/2);
      if(Number.isFinite(estimate(before,recipe.output.itemId,n*recipe.output.qty,{reserve}).seconds))lo=n;else hi=n-1;
    }
    return lo;
  }
  function ingredients(id,seen=new Set()) {
    if(seen.has(id))return [];seen.add(id);
    const original=data.jobs.find(j=>j.output.itemId===planner.base(id)&&j.inputs.length&&!j.grow);
    const job=original&&craftRecipe(data,original,rarityOf(data,id));
    return job?[...new Set(job.inputs.flatMap(i=>[i.itemId,...ingredients(i.itemId,seen)]))]:[];
  }
  return {estimate,shortfall,available,ingredients};
}

export function bankedGatheringLoad(data,before,p) {
  const route=p.route,old=before?.route;
  if(!before||before.id!==p.id||p.lastTick<=before.lastTick||!route||!old||route.errand||old.errand||
    route.jobId!==old.jobId||route.siteId!==old.siteId||route.zoneId!==old.zoneId)return false;
  const job=data.jobs.find(j=>j.id===route.jobId);
  if(!job||job.inputs.length||!['mining','fishing','woodcutting'].includes(job.skill)||
    data.items[job.output.itemId]?.stackable)return false;
  const gained=id=>(p.bank[id]??0)-(before.bank[id]??0)-
    Math.max(0,(before.overflow?.[id]??0)-(p.overflow?.[id]??0));
  if(before.pack.some(item=>{
    if(baseId(data,item.itemId)!==job.output.itemId)return false;
    const moved=packQty(before,item.itemId)-packQty(p,item.itemId);
    return moved>0&&gained(item.itemId)>=moved;
  }))return true;
  // A snapshot can arrive after banking and refilling the next partial pack.
  // Its size need not decrease; gathering XP plus new shelved output still
  // identifies the completed trip. Overflow moving back to shelves does not.
  return (p.skills?.[job.skill]??0)>(before.skills?.[job.skill]??0)&&
    Object.keys(p.bank).some(id=>baseId(data,+id)===job.output.itemId&&gained(id)>0);
}

export function finishTaskReason(data,p) {
  const route=p.route,original=data.jobs.find(j=>j.id===route?.jobId);
  const job=original&&(original.inputs.length&&!original.grow?craftRecipe(data,original,p.workRarity??route?.rarity??0):original);
  // The game's fallback activity is only an idle filler: it is replaced at
  // once, not finished like the helper's own trips. Besides its flag, it is
  // recognised as the saved fallback task running without a limit (every
  // route the helper starts has a numeric limit; 0 means unlimited).
  const filler=route?.fallback||route?.limit==null&&p.fallback?.task?.jobId===route?.jobId;
  if (!job||job.grow||route.errand||filler||!route.phase||route.phase==='toBank'||route.limit===0) return null;
  const base=id=>baseId(data,id);
  const free=packFree(data,p);
  const output=data.items[base(job.output.itemId)];
  if (['mining','fishing','woodcutting'].includes(job.skill)&&!job.inputs.length&&!output?.stackable) {
    return free>=job.output.qty?'继续当前采集，背包满或本批完成后再切换任务':null;
  }
  if (!['smithing','cooking','fletching','herblore','crafting'].includes(job.skill)||
    route.limit!==null&&!(route.limit>0)) return null;
  if(route.limit===null&&output?.stackable&&job.inputs.every(i=>data.items[base(i.itemId)]?.stackable))return null;
  let freed=0;
  for (const input of job.inputs) {
    const count=packQty(p,input.itemId);
    if (count<input.qty) return null;
    freed+=data.items[base(input.itemId)]?.stackable?Number(count===input.qty):input.qty;
  }
  const extra=output?.stackable?Number(!p.pack.some(i=>i.itemId===job.output.itemId)):job.output.qty;
  return free+freed>=extra?'完成背包中已备材料的当前批次，再切换任务':null;
}
