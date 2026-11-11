import {matchesProfessionWeapon, professionSkill, starterWeapon} from './professions.js';
import {PAIR_TIERS, autoUsableMaterial, craftRecipe, qualityWorth, setsAt} from './quality.js';
import {combatEstimate, workEstimate} from './estimates.js';
import {goldToSeconds} from './gold.js';
import {harvestCrops} from './farming.js';
import {combatSafe, combatStats, workInputs} from './rates.js';
import {buffKey, combatSupplies} from './supplies.js';
import {baseId, distance, nearestBank, packCapacity, packQty, seedVendorPrice} from './items.js';
import {COMBAT_SKILLS, combatKey, equipmentKey, jobKey, levelsKey, usableSample} from './keys.js';

// One rule for leaving the current task: another must do more than 10%
// better on the same (day-averaged) rates. Estimates move a little from plan
// to plan; a smaller gain is not worth the swap.
export const SWITCH_MARGIN=1.1;
export const outscores=(candidate,current)=>candidate>current*SWITCH_MARGIN;

// A rolling comparison of attainable routes, including their self-supply work.
// Gold is a constraint from an actual planned expense, never an XP conversion.
export function createStrategy(data, planner) {
  const horizon=1800, tick=data.tickMs/1000, jobs=data.jobs;
  const bankAt=p=>nearestBank(data,p);
  const siteAt=(p,j)=>data.sites.filter(s=>s.jobIds.includes(j.id))
    .sort((a,b)=>distance(p,a)-distance(p,b))[0];
  let measurements={};
  const setMeasurements=value=>{measurements=value??{};};
  // The measurement (real or simulated) that applies to this state, or null.
  function usableMeasurement(p,key,lv=planner.levels(p)) {
    const m=measurements[key];
    if (!usableSample(m)) return null;
    // Observed rates already include their buffs. Legacy records describe only
    // an unbuffed snapshot; never carry a temporary bonus into another state.
    if((m.buffKey??buffKey(data,{...p,brews:{}}))!==buffKey(data,p))return null;
    const job=key.startsWith('job:')&&jobs.find(j=>j.id===Number(key.split(':')[1]));
    if (m.equipmentKey!==equipmentKey(p)||m.levelsKey!==levelsKey(job?[job.skill]:COMBAT_SKILLS,s=>lv[s])) return null;
    return m;
  }
  // Every rate is the game's formula (estimates.js with rates.js's inputs, the
  // XP multiplier included): its output is the expected value, and an observed
  // stretch only adds luck. Measurements and engine simulations decide one
  // thing: a route that died in this state (gear, levels, potions) is
  // worthless now. (Until v0.15.3 a learnt observed/formula ratio scaled the
  // rates; it mostly stood in for the XP multiplier the formula then lacked.)
  let formulaOnly=false;
  // Runs `fn` without the death check: both sides of a gear swap are judged
  // alike, since a measurement only exists for the worn set.
  function byFormula(fn) {
    const was=formulaOnly;formulaOnly=true;
    try{return fn();}finally{formulaOnly=was;}
  }
  function survived(p,key,e,lv) {
    if(formulaOnly)return e;
    return usableMeasurement(p,key,lv)?.deaths?{...e,xp:0,coins:0}:e;
  }
  function estimateWork(p,j,lv=planner.levels(p)) {
    return survived(p,jobKey(j.id,j.rarity),workEstimate(data,j,lv[j.skill],workInputs(data,planner,p,j)),lv);
  }
  // A fight's estimate: the formula, worthless when it died in this state.
  const fightEstimate=(p,m,stats,lv=planner.levels(p))=>survived(p,combatKey(m.id),combatEstimate(data,m,stats),lv);
  function combatOptions(p,profession='magic') {
    const lv=planner.levels(p);
    if (!matchesProfessionWeapon(planner.equipmentStats(p.equipment.weapon),profession)) return [];
    const stats=combatStats(data,planner,p,profession,p.equipment,lv);
    return data.monsters.filter(m=>combatSafe(lv,stats,m))
      .map(m=>({monster:m,zone:data.zones.find(z=>z.monsterId===m.id),
        ...fightEstimate(p,m,stats,lv)}));
  }
  // Seconds to get one more unit of a supply (fight food): the shared input
  // cost's price (bought, or made with the XP credited), the one price every
  // combat choice and the food purchase use. Remembered per state.
  const supplyCosts=new Map();
  function supplyCost(p,id) {
    const key=JSON.stringify([p.id,p.lastTick,id,planner.styleHint??'magic']);
    if(!supplyCosts.has(key)) {
      if(supplyCosts.size>=256)supplyCosts.delete(supplyCosts.keys().next().value);
      supplyCosts.set(key,planner.inputCost?planner.inputCost.unitSeconds(p,id,1,{style:planner.styleHint??'magic'}):Infinity);
    }
    return supplyCosts.get(key);
  }
  function routeEstimate(p,jobOrId,amount=20,{style='magic',ignoreStock=false,includeTravel=true,completeTrips=false,buyInputs=false,credit=true}={}) {
    const root=typeof jobOrId==='object'?jobOrId:jobs.find(j=>j.id===jobOrId);
    const lv=planner.levels(p), stock={}, budget={}, recipes={}, supplyRecipes={};
    if (!ignoreStock) {
      for (const [id,n] of Object.entries(p.bank)) stock[id]=n;
      for (const i of p.pack) stock[i.itemId]=(stock[i.itemId]??0)+i.qty;
    }
    // Coins are what the route earns and spends: coins and market purchases.
    // Held materials are priced apart (planner.ownedGold), for callers that weigh the
    // whole cost against the output's value: in coins alone, with the output
    // unvalued, every craft looked like millions lost an hour.
    let seconds=0,xp=0,coins=0,position=p,unlocks=[],marketCoins=0,boughtSeconds=0;
    // `owned`: how much of the stock held at the start the route uses up (not
    // what it makes and uses on the way), for callers that do price it: the
    // gold table charges it at what it would sell for.
    const purchases={},owned={},startStock={...stock};
    const travel=to=>{
      if (includeTravel) seconds+=distance(position,to)*tick;
      position=to;
    };
    const invalid=()=>({seconds:Infinity,xp:0,coins:0,budget:{coins:0,items:{}},recipes:{},supplyRecipes:{},purchases:{}});
    function work(j,n,trail) {
      if (!siteAt(position,j)||j.grow||!Number.isFinite(n)||n<=0) return false;
      if (lv[j.skill]<j.levelReq&&!unlock(j.skill,j.levelReq,trail)) return false;
      for (const i of j.inputs) if (!supply(i.itemId,i.qty*n,trail)) return false;
      const e=estimateWork(p,j,lv),site=siteAt(position,j),bank=bankAt(site);
      travel(site);
      seconds+=e.seconds*n;xp+=e.xp*n;coins+=e.coins*n;
      // Project size and carried loads are separate. Nonstacked materials need
      // native bank trips; an all-stack recipe does not bank every fifty units.
      const stackSlots=j.inputs.filter(i=>data.items[baseId(data,i.itemId)]?.stackable).length+
        Number(!!data.items[j.output.itemId]?.stackable);
      const unitSlots=Math.max(data.items[j.output.itemId]?.stackable?0:j.output.qty,
        j.inputs.reduce((n,i)=>n+(data.items[baseId(data,i.itemId)]?.stackable?0:i.qty),0));
      const load=unitSlots?Math.max(1,Math.floor((packCapacity(p)-stackSlots)/unitSlots)):Infinity;
      if (includeTravel) seconds+=Math.max(0,Math.ceil(n/load)-1)*(2*distance(site,bank)+3)*tick;
      if(completeTrips)travel(bank.approach??bank);
      recipes[j.skill]??=j.id;supplyRecipes[j.output.itemId]=j.id;
      if (j.output.itemId!==data.coinId) stock[j.output.itemId]=(stock[j.output.itemId]??0)+e.commonOutput*n;
      if (j.bonus) stock[j.bonus.itemId]=(stock[j.bonus.itemId]??0)+j.bonus.chance*n;
      return true;
    }
    function unlock(skill,target,trail) {
      const marker=`skill:${skill}`;
      if (trail.includes(marker)) return false;
      const available=jobs.filter(j=>j.skill===skill&&!j.grow&&j.levelReq<=lv[skill]&&siteAt(position,j));
      const choice=available.sort((a,b)=>estimateWork(p,b,lv).xp/estimateWork(p,b,lv).seconds-
        estimateWork(p,a,lv).xp/estimateWork(p,a,lv).seconds)[0];
      if (!choice) return false;
      const required=planner.xpTo(p,skill,target);
      const n=Math.ceil(required/estimateWork(p,choice,lv).xp);
      if (!work(choice,n,[...trail,marker])) return false;
      unlocks.push({skill,target});lv[skill]=target;return true;
    }
    function supply(id,quantity,trail) {
      if(!autoUsableMaterial(data,id))return false;
      budget[id]=(budget[id]??0)+Math.ceil(quantity);
      const used=Math.max(0,Math.min(quantity,stock[id]??0));stock[id]=(stock[id]??0)-used;
      const own=Math.min(used,startStock[id]??0);
      if(own>0){startStock[id]-=own;owned[id]=(owned[id]??0)+own;}
      const missing=quantity-used;
      if (missing<1e-7) return true;
      if (trail.includes(id)) return false;
      const next=[...trail,id];
      if(buyInputs&&id!==root?.output?.itemId&&id!==root?.itemId) {
        const qty=Math.ceil(missing),cost=qty*(planner.marketBuyPrice?.(p,id,qty+(purchases[id]??0))??Infinity);
        const unit=goldToSeconds(cost,planner.coinRate?.(p)??0)/qty,allowance=planner.marketAllowance?.(p)??0;
        // The one make-or-buy verdict (input-cost.js decide): bought when it
        // says so and the coins allow; else made or gathered below.
        const buyIt=Number.isFinite(unit)&&cost>0&&!!planner.inputCost&&
          planner.inputCost.decide({...p,x:position.x,y:position.y},id,missing,{style,credit}).buy;
        if(buyIt&&marketCoins+cost+Math.max(0,-coins-marketCoins)<=allowance) {
          const bank=bankAt(position),to=bank.approach??bank;
          // Bought: its coins, and the same gold as time at the gold rate for the
          // XP ranking (gold as time). The latter is kept apart (boughtSeconds):
          // what earns or spends gold weighs the coins and the real time only.
          travel(to);seconds+=unit*qty;boughtSeconds+=unit*qty;coins-=cost;marketCoins+=cost;
          purchases[id]=(purchases[id]??0)+qty;
          stock[id]=(stock[id]??0)+qty-missing;
          return true;
        }
      }
      if(id===190) {
        const price=seedVendorPrice(data);
        coins-=price;travel(bankAt(position).approach??bankAt(position));seconds+=tick;
        return true;
      }
      // The producer the shared input cost chooses first (need() produces with it).
      const preferred=planner.inputCost?.producer({...p,x:position.x,y:position.y},id,missing,{style,credit})?.id;
      const choices=jobs.filter(j=>j.output.itemId===id&&!j.grow&&siteAt(position,j))
        .sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred)||a.levelReq-b.levelReq||estimateWork(p,a,lv).seconds/Math.max(.001,estimateWork(p,a,lv).commonOutput)-
          estimateWork(p,b,lv).seconds/Math.max(.001,estimateWork(p,b,lv).commonOutput));
      if (choices.length) {
        const j=choices[0],e=estimateWork(p,j,lv);
        if (!work(j,missing/e.commonOutput,next)) return false;
        stock[id]=Math.max(0,(stock[id]??0)-missing);return true;
      }
      // Harvests regenerate seeds. A crop source is attainable only when its
      // seed already exists, or a reviewed bonus drop supplies it. Unknown
      // merchant-only seeds never receive an invented acquisition time.
      const crop=jobs.find(j=>j.output.itemId===id&&j.grow&&j.levelReq<=lv.farming);
      if (crop) {
        const preference=planner.farmingPreference?.();
        if(preference?.mode==='manual'&&preference.jobId!==crop.id)return false;
        const planted=Object.values(p.plots??{}).some(f=>planner.base(f.seedItemId)===crop.inputs[0].itemId);
        const seeds=Object.keys(stock).some(k=>planner.base(Number(k))===crop.inputs[0].itemId&&stock[k]>0);
        if (!planted&&!seeds&&!supply(crop.inputs[0].itemId,1,next)) return false;
        const seedId=crop.inputs[0].itemId;
        const liveSeeds=Object.entries(stock).reduce((n,[id,qty])=>n+(planner.base(+id)===seedId?qty:0),0)+
          Object.values(p.plots??{}).filter(f=>planner.base(f.seedItemId)===seedId).length;
        const fields=Math.max(1,Math.min(planner.farmFields?.(p).length??data.farmUnlocks.filter(n=>n<=lv.farming).length,liveSeeds));
        const harvests=missing/harvestCrops(lv.farming,planner.equipmentStats(p.equipment?.hoe)?.bonus??0);
        seconds+=Math.ceil(harvests/fields)*crop.grow*tick;xp+=harvests*crop.xp;
        recipes.farming=crop.id;supplyRecipes[id]=crop.id;
        return true;
      }
      const bonus=planner.bonusSource?.(p,id); // the one bonus source (need() and the input cost use it)
      if (bonus) {
        if (!work(bonus,missing/bonus.bonus.chance,next)) return false;
        stock[id]=Math.max(0,(stock[id]??0)-missing);return true;
      }
      // The monster fight() would take for this drop: the one combat score
      // (planner.combatChoice, per drop or shard, food and travel included).
      const dropScore=c=>planner.combatChoice?.(p,style,c.monster,{requiredItem:id})?.score??0;
      const monster=combatOptions(p,style).filter(c=>c.monster.drop===id&&(c.monster.dropChance??1)>0||id===data.shardId)
        .sort((a,b)=>dropScore(b)-dropScore(a)||a.monster.id-b.monster.id)[0];
      if (!monster) return false;
      // A primary drop is one item of a rolled quality, not one ordinary item:
      // the fight's expected commons per kill (combatDrops, the one quality factor).
      const perKill=id===data.shardId?monster.shards:monster.drops?.[id]??0;
      if (!(perKill>0)) return false;
      return fight(monster,missing/perKill,next);
    }
    function fight(c,n,trail=[]) {
      const supplies=combatSupplies(data,planner,p,c,{zone:c.zone,monster:c.monster,
        foodItemId:0,horizon,supplyCost:id=>supplyCost(p,id)});
      if (!supplies.sustainable||!supply(supplies.foodItemId,c.damage*n/supplies.heal,trail)) return false;
      const bank=bankAt(c.zone);
      const carried=packQty(p,supplies.foodItemId);
      const restockFirst=position!==p||supplies.bankFirst||!carried;
      if(restockFirst)travel(bankAt(position));
      const inside=position.x>=c.zone.x&&position.x<c.zone.x+(c.zone.width??1)&&
        position.y>=c.zone.y&&position.y<c.zone.y+(c.zone.height??1);
      if(!inside)travel(c.zone);
      const firstKills=restockFirst?supplies.expectedKills:
        Math.min(supplies.expectedKills,carried/supplies.safeFoodPerKill);
      const restocks=Math.max(0,Math.ceil((n-firstKills)/supplies.expectedKills));
      seconds+=c.seconds*n+(includeTravel?restocks*supplies.roundTripSeconds:0);
      xp+=c.xp*n;coins+=c.coins*n;
      if(completeTrips)travel(bank.approach??bank);
      return true;
    }
    let ok=false;
    if (root?.itemId!=null) {
      // Quote an additional missing quantity, while still using owned inputs.
      stock[root.itemId]=0;
      ok=supply(root.itemId,amount,[]);
    } else if (root?.monsterId) {
      const c=combatOptions(p,style).find(c=>c.monster.id===root.monsterId);
      ok=!!c&&fight(c,amount);
    } else if (root) ok=work(root,amount,[root.output.itemId]);
    if (!ok||!Number.isFinite(seconds)) return invalid();
    return {seconds,xp,coins,rate:{xp:xp/Math.max(1,seconds),coins:coins/Math.max(1,seconds)},
      budget:{coins:Math.max(0,-coins-marketCoins),items:budget},recipes,supplyRecipes,unlocks,purchases,owned,boughtSeconds};
  }
  // The held stock a route uses up (estimate.owned), at what it would sell for
  // now (planner.stockValue): the one price every caller weighing a route's
  // whole cost adds.
  const ownedGold=(p,estimate)=>Object.entries(estimate?.owned??{}).reduce((n,[id,qty])=>
    n+(qty>0?(planner.stockValue??planner.saleValue)(p,Number(id),Math.max(1,Math.round(qty)))*qty:0),0);
  function candidates(p,style='magic',deferred={},options={}) {
    const skill=professionSkill(style);
    const stockedBatch=options.stockedBatch===true;
    const routeOptions={style,ignoreStock:!!options.sustainable,completeTrips:!!options.sustainable||stockedBatch,buyInputs:true};
    const lv=planner.levels(p), candidates=[];
    planner.watchPurchases?.(p,jobs.filter(j=>!j.grow&&!deferred[j.skill]&&j.levelReq<=lv[j.skill])
      .flatMap(j=>j.inputs.map(i=>i.itemId)));
    for (const job of jobs.filter(j=>!j.grow&&!deferred[j.skill]&&j.levelReq<=lv[j.skill]&&siteAt(p,j))) {
      const batch=stockedBatch?Math.min(50,planner.carriedBatch(p,job)):50;
      if(stockedBatch&&(!job.inputs.length||job.inputs.some(i=>planner.count(p,i.itemId)<i.qty*batch)))continue;
      const e=estimateWork(p,job,lv);
      let amount=options.sustainable||stockedBatch?batch:Math.min(job.inputs.length?50:5000,Math.max(1,Math.floor(horizon/e.seconds))),estimate;
      for (let attempt=0;attempt<4;attempt++) {
        estimate=routeEstimate(p,job,amount,routeOptions);
        if(options.sustainable||stockedBatch)break;
        if (estimate.seconds<=horizon||!Number.isFinite(estimate.seconds)||amount===1) break;
        amount=Math.max(1,Math.floor(amount*horizon/estimate.seconds*.98));
      }
      if (estimate.seconds>horizon) continue;
      if (!Number.isFinite(estimate.seconds)||!estimate.xp) continue;
      // Gathered output of every quality and the bonus drop, as expected counts.
      const extras=!job.inputs.length&&job.output.itemId!==data.coinId?{actions:amount,
        qualityPerAction:e.tierOutput.slice(1),
        ...(job.bonus?{bonusPerAction:{itemId:job.bonus.itemId,qty:e.bonusOutput}}:{})}:{};
      // Rated as train() rates it (the shared batch rating); the route
      // estimate stays for its time, coins and budget.
      const rated=planner.batchRating?.(p,job,{profession:style})??estimate.rate.xp;
      candidates.push({skill:job.skill,recipeId:job.id,mainXpRate:rated,output:{itemId:job.output.itemId,qty:Math.floor(e.commonOutput*amount)},...extras,recipes:{...estimate.recipes,[job.skill]:job.id},
        supplyRecipes:estimate.supplyRecipes,batch,estimate,rate:{...estimate.rate,xp:rated},horizon,
        budget:routeEstimate(p,job,batch,{style,buyInputs:true}).budget,target:lv[job.skill]+1,stage:lv[job.skill]+1});
      // The same recipe in a quality the held matched sets make (planned gear's
      // materials kept), valued at that quality: its output is worth more.
      if(job.inputs.length&&!stockedBatch&&!options.sustainable) {
        const hold=planner.qualityHold?.(p,style,{gearOnly:true})??{};
        for(const tier of PAIR_TIERS.filter(t=>t>0)) {
          const recipe=craftRecipe(data,job,tier),n=Math.min(amount,setsAt(recipe,id=>planner.count(p,id)-(hold[id]??0)));
          if(!(n>=1)||!qualityWorth(data,planner,p,job,tier).ok)continue;
          const q=routeEstimate(p,recipe,n,{...routeOptions,buyInputs:false});
          if(!Number.isFinite(q.seconds)||!q.xp)continue;
          const qe=estimateWork(p,recipe,lv);
          const qualityRate=planner.batchRating?.(p,recipe,{profession:style,n:Math.min(20,n),reserve:hold})??q.rate.xp;
          candidates.push({skill:job.skill,recipeId:job.id,rarity:tier,mainXpRate:qualityRate,
            output:{itemId:recipe.output.itemId,qty:Math.floor(qe.commonOutput*n)},recipes:{...q.recipes,[job.skill]:job.id},
            recipeRarities:{[job.skill]:tier},supplyRecipes:q.supplyRecipes,batch:n,estimate:q,rate:{...q.rate,xp:qualityRate},horizon,
            budget:q.budget,target:lv[job.skill]+1,stage:lv[job.skill]+1});
        }
      }
    }
    if(stockedBatch)return candidates.sort((a,b)=>b.mainXpRate-a.mainXpRate||a.recipeId-b.recipeId);
    let fighter=p,preparation={seconds:0,xp:0,coins:0,budget:{coins:0,items:{}}};
    if (!matchesProfessionWeapon(planner.equipmentStats(p.equipment.weapon),style)) {
      const starter=starterWeapon(style);
      const recipe=jobs.find(j=>j.output.itemId===starter);
      preparation=planner.count(p,starter)>0?preparation:routeEstimate(p,recipe,1,{style});
      fighter={...p,equipment:{...p.equipment,weapon:starter}};
      if (planner.equipmentStats(starter)?.twoHanded) fighter.equipment.shield=null;
    }
    if (!deferred[skill]&&Number.isFinite(preparation.seconds)) for (const c of combatOptions(fighter,style)) {
      const supplies=combatSupplies(data,planner,fighter,c,{zone:c.zone,monster:c.monster,
        foodItemId:0,horizon:Math.max(1,horizon-preparation.seconds),supplyCost:id=>supplyCost(fighter,id)});
      if (!supplies.sustainable||supplies.horizonKills<1) continue;
      const estimate=routeEstimate(fighter,{monsterId:c.monster.id},Math.max(1,Math.floor(supplies.horizonKills)),routeOptions);
      estimate.seconds+=preparation.seconds;estimate.xp+=preparation.xp;estimate.coins+=preparation.coins;
      estimate.rate={xp:estimate.xp/estimate.seconds,coins:estimate.coins/estimate.seconds};
      const kills=Math.max(1,Math.floor(supplies.horizonKills));
      // Rated as fight() rates it (planner.combatChoice); the route estimate
      // stays for its time, coins and budget.
      const choice=planner.combatChoice?.(fighter,style,c.monster);
      if (Number.isFinite(estimate.seconds)) candidates.push({skill,monsterId:c.monster.id,kills,drops:c.drops,
        mainXpRate:choice?choice.mainXpPerMinute/60:c.mainXp*kills/estimate.seconds,
        estimate,rate:{...estimate.rate,xp:choice?choice.xpPerMinute/60:estimate.rate.xp},horizon,budget:routeEstimate(fighter,{monsterId:c.monster.id},20,{style}).budget,
        recipes:estimate.recipes,target:lv[skill]+1,stage:lv[skill]+1});
    }
    return candidates.sort((a,b)=>b.rate.xp-a.rate.xp||b.rate.coins-a.rate.coins||a.recipeId-b.recipeId);
  }
  // Profit floor (gold/hour): keep only tasks earning at least that much,
  // counting sales the current bids absorb, then maximise XP. If none
  // qualifies, earn as fast as possible instead.
  function withProfitFloor(p,choices,style,floor) {
    planner.watchMarket?.(p,choices.map(c=>c.output?.itemId??data.monsters.find(m=>m.id===c.monsterId)?.drop).filter(Boolean));
    // Priced by the gold table (incomeRows), as the plan tab's gold column and
    // its floor buttons are; a job absent from it earns nothing.
    const income=new Map((planner.incomeRows?.(p,style)??[]).map(r=>[r.key,r]));
    const priced=choices.map(c=>{
      const row=income.get(c.monsterId!=null?combatKey(c.monsterId):jobKey(c.recipeId,c.rarity));
      return row?{...c,rate:{...c.rate,coins:row.coins},saleItems:row.saleItems}:null;
    }).filter(c=>c&&c.rate.coins>0);
    const enough=priced.filter(c=>c.rate.coins*3600>=floor).sort((a,b)=>b.rate.xp-a.rate.xp);
    if(enough.length)return {choices:enough,note:`收益不低于 ${floor} 金币/小时的工作中经验最高`};
    const richest=[...priced].sort((a,b)=>b.rate.coins-a.rate.coins);
    return {choices:richest,note:richest.length?`没有工作达到 ${floor} 金币/小时，改做收益最高的工作`:''};
  }
  function chooseGoal(p,served={},deferred={},style='magic',options={}) {
    let choices=candidates(p,style,deferred),note='';
    const floor=Math.max(0,typeof options==='object'&&options?.profitFloor||0);
    if(floor>0&&choices.length){
      const filtered=withProfitFloor(p,choices,style,floor);
      if(filtered.choices.length)({choices,note}=filtered);
    }
    if (!choices.length) return null;
    let best=choices[0];
    const current=choices.find(c=>c.recipeId===p.route?.jobId||c.monsterId&&data.zones.find(z=>z.id===p.route?.zoneId)?.monsterId===c.monsterId);
    // The model already charges travel; an active route stays unless another
    // is clearly better (SWITCH_MARGIN).
    if (current&&!outscores(best.rate.xp,current.rate.xp)) best=current;
    // Gold as the gold table prices it (sales included), the one figure shown everywhere.
    const key=best.monsterId!=null?combatKey(best.monsterId):jobKey(best.recipeId,best.rarity);
    const coins=note?best.rate.coins:planner.incomeRows?.(p,style).find(r=>r.key===key)?.coins??0;
    const goal={...best,reason:`${note?note+'；':''}滚动 ${horizon/60} 分钟：采购／自备后的总经验约 ${(best.rate.xp*60).toFixed(0)}/分，`+
      `收益约 ${Math.round(coins*3600).toLocaleString()} 金币/时（金币效率表口径，含出售产物）；已计供料与旅行`};
    return goal;
  }
  return {chooseGoal,candidates,routeEstimate,ownedGold,estimateWork,combatOptions,fightEstimate,byFormula,setMeasurements,supplyCost,horizon,
    routeMeasurement:(p,key)=>usableMeasurement(p,key)};
}
