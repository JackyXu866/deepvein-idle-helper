import {matchesProfessionWeapon, professionSkill} from '../planner/professions.js';
import {finishTaskReason} from '../planner/crafting.js';
import {combatEstimate, workEstimate} from '../planner/estimates.js';
import {enhanceQuote, inventoryBudget, reviewInventory} from '../planner/inventory.js';
import {planEnhancement} from '../planner/enhancement.js';
import {distance, merchantPrice, nearestBank, packCapacity, packQty, packUsed, plusOf} from '../planner/items.js';

// Items made by crafting skills (cooking, smithing, fletching, crafting).
// Potions are protected separately and never sold.
const CRAFT_SKILLS=new Set(['cooking','smithing','fletching','crafting']);

export function createEconomy(data,planner,{autoSell=false,capacitySales=false,sellCrafted=true}={}) {
  const craftedIds=new Set(data.jobs.filter(j=>CRAFT_SKILLS.has(j.skill)&&!j.grow).map(j=>j.output.itemId));
  let lastGoal=null,lastPlayer=null,lastStyle=null,lastMode=null,lastMain=null,lastJob=null,lastMonster=null,investmentGoal=null,gearDeferredUntil=0,recovery=null;
  planner.pendingEquipmentPlan=(p,style)=>p.id===lastPlayer&&style===lastStyle?investmentGoal:null;
  const budget=(p,goal)=>inventoryBudget(data,planner,p,goal);
  const review=(p,goal,style='magic')=>reviewInventory(data,planner,p,goal,style);
  const action=(intent,label,reason='',extra={})=>({intent,label,reason,...extra});
  const value=id=>merchantPrice(data,id);
  const bankFor=p=>nearestBank(data,p);
  const atBank=(p,intent,label,reason,extra={})=>planner.nearBank(p)?action(intent,label,reason,extra):
    action({t:'walk',...bankFor(p).approach},'整理库存 · 前往仓库',reason||label,extra);
  function investment(p,goal,style,reserve,includeUnfunded=false) {
    if(p.enhance)return null;
    const lv=planner.levels(p),combatSkill=professionSkill(style);
    const relevant=gear=>(!gear.style||gear.style===combatSkill)&&
      (gear.slot!=='weapon'||matchesProfessionWeapon(gear,style))&&
      (gear.slot!=='shield'||style!=='melee_twohand');
    const job=data.jobs.find(j=>j.id===(goal?.recipeId??goal?.recipes?.[goal?.skill]??p.route?.jobId));
    const monster=data.monsters.find(m=>m.id===(goal?.monsterId??data.zones.find(z=>z.id===p.route?.zoneId)?.monsterId));
    const stats=(equipment)=>{
      const gear=Object.entries(equipment).filter(([slot,id])=>Number.isFinite(id)&&
        (slot!=='shield'||style!=='melee_twohand')).map(([,id])=>planner.equipmentStats(id)).filter(Boolean);
      const weapon=planner.equipmentStats(equipment.weapon);
      const sum=k=>gear.reduce((n,g)=>n+(k==='defence'||!g.style||g.style===combatSkill?1:-1)*(g[k]??0),0);
      return {style:combatSkill,level:lv[combatSkill],accuracy:sum('accuracy'),strength:sum('strength'),
        defence:sum('defence'),defenceLevel:lv.defence,speed:weapon?.speed??5,twoHanded:weapon?.twoHanded};
    };
    const candidates=[];
    for(const [slot,id]of Object.entries(p.equipment)) {
      const gear=planner.equipmentStats(id);
      if(!gear||plusOf(data,id)!==0||slot==='hoe'||slot==='mount')continue;
      if(planner.enhancementTraining?.blocked(p,id,slot))continue;
      if(!relevant(gear))continue;
      if(goal?.upgrade?.slot===slot)continue;
      if(p.id===lastPlayer&&style===lastStyle&&investmentGoal?.upgrade?.slot===slot)continue;
      const quote=enhanceQuote(data,planner,p,id),next=planner.equipmentStats(id+data.plusScale);
      const otherCoins=Math.max(0,reserve.coins-(goal?.enhancement?.itemId===id?goal.enhancement.gold:0));
      if(quote.chance!==1||!includeUnfunded&&p.coins<quote.gold+otherCoins||
        planner.count(p,data.shardId)<quote.shards+(reserve.items[data.shardId]??0))continue;
      let coinGain=0,xpGain=0,xpRate=0,skill=null;
      const toolSkill=data.toolSkills[slot];
      if(toolSkill&&job?.skill===toolSkill&&!job.grow) {
        const opts={quick:p.perks?.quick??0,hands:p.perks?.hands??0};
        const before=workEstimate(data,job,lv[job.skill],{...opts,toolBonus:gear.bonus});
        const after=workEstimate(data,job,lv[job.skill],{...opts,toolBonus:next.bonus});
        const inputs=job.inputs.reduce((n,i)=>n+value(i.itemId)*i.qty,0);
        const profit=e=>e.coins+e.commonOutput*(job.output.itemId===data.coinId?0:value(job.output.itemId))-inputs;
        coinGain=profit(after)/after.seconds-profit(before)/before.seconds;
        xpRate=before.xp/before.seconds;xpGain=after.xp/after.seconds-xpRate;skill=job.skill;
      } else if(!toolSkill&&monster&&['magic','melee','ranged','defence','hitpoints'].includes(goal?.skill)) {
        const before=combatEstimate(data,monster,stats(p.equipment));
        const after=combatEstimate(data,monster,stats({...p.equipment,[slot]:id+data.plusScale}));
        const foods=Object.values(data.items).filter(i=>i.heals&&planner.count(p,i.id)>0);
        const healValue=foods.length?Math.min(...foods.map(i=>value(i.id)/Math.min(i.heals,lv.hitpoints*.5))):0;
        // Count only guaranteed coins and reduced food use; rare drops stay protected.
        coinGain=(after.coins-after.damage*healValue)/after.seconds-
          (before.coins-before.damage*healValue)/before.seconds;
        xpRate=before.xp/before.seconds;xpGain=after.xp/after.seconds-xpRate;skill=combatSkill;
      }
      if(!(coinGain>0)||xpGain<0)continue;
      // Shards have an opportunity cost even when already owned. Pay back within
      // the current planning window, or before the next equipment tier arrives.
      let horizon=goal?.horizon??1800;
      const currentRequirement=gear.levelReq??data.jobs.find(j=>j.output.itemId===planner.base(id))?.levelReq??1;
      const nextRequirement=data.gear.filter(g=>g.slot===slot&&relevant(g))
        .map(g=>g.levelReq??data.jobs.find(j=>j.output.itemId===g.itemId)?.levelReq??1)
        .filter(n=>n>Math.max(lv[skill]??1,currentRequirement)).sort((a,b)=>a-b)[0];
      if(nextRequirement&&xpRate>0)horizon=Math.min(horizon,
        (planner.thresholds[nextRequirement]-p.skills[skill])/xpRate);
      const cost=quote.gold+quote.shards*value(data.shardId),paybackSeconds=cost/coinGain;
      if(!Number.isFinite(paybackSeconds)||!Number.isFinite(horizon)||paybackSeconds>horizon)continue;
      candidates.push({id,slot,quote,cost,coinGain,xpGain,paybackSeconds,horizon,requiredCoins:quote.gold+otherCoins});
    }
    candidates.sort((a,b)=>a.paybackSeconds-b.paybackSeconds);
    return candidates[0]??null;
  }
  function investmentBudget(p,goal,style='magic') {
    const next=investment(p,goal,style,budget(p,goal),true);
    return next?{coins:next.requiredCoins,enhancement:{itemId:next.id,gold:next.quote.gold,shards:next.quote.shards}}:null;
  }
  function maintenance(p,goal,style='magic',mode='balanced',mainTrade='auto',mainJobId=null,mainMonsterId=null) {
    if(mode!=='business'){mainJobId=null;mainMonsterId=null;}
    if(p.id!==lastPlayer||style!==lastStyle||mode!==lastMode||mainTrade!==lastMain||mainJobId!==lastJob||mainMonsterId!==lastMonster){lastGoal=null;investmentGoal=null;gearDeferredUntil=0;recovery=null;lastPlayer=p.id;lastStyle=style;lastMode=mode;lastMain=mainTrade;lastJob=mainJobId;lastMonster=mainMonsterId;}
    if(mode==='business'&&goal?.mainSkill!==professionSkill(style)||goal?.development&&goal.skill!==professionSkill(style))investmentGoal=null;
    const upgrading=goal?.upgrade?.priority||goal?.toolUpgrade?.upgrade?.priority;
    if(upgrading||goal?.itemTarget)investmentGoal=null;
    if(goal)lastGoal=goal;
    // Preserve the in-flight supply budget across a reconnect/goal-selection gap.
    let protection=goal??lastGoal;
    if(investmentGoal) {
      const current=budget(p,protection),invest=budget(p,investmentGoal),items={...current.items};
      for(const [id,qty]of Object.entries(invest.items))items[id]=Math.max(items[id]??0,qty);
      protection={...protection,upgrade:investmentGoal.upgrade,
        recipes:{...protection?.recipes,...investmentGoal.recipes},budget:{coins:current.coins+invest.coins,items}};
    }
    // An ordinary inventory detour would overwrite the game's saved farm errand.
    // Capacity emergencies are the only reason to interrupt that trip.
    const capacity=budget(p,protection);
    const blockedPack=capacity.freeSlots<=0&&p.pack.some(i=>(p.bank[i.itemId]??0)<=0);
    const overflow=Object.values(p.overflow??{}).some(n=>n>0)||blockedPack;
    const recoveryFlags={inventoryRecovery:true,capacityLimited:true};
    const waiting=()=>action(null,'等待溢出物品归仓',
      '仓库已有可用空间；等待新状态确认归仓，不反复取放或出售旧库存',
      {...recoveryFlags,refreshInventory:true});
    const overflowKey=()=>JSON.stringify([capacity.freeSlots,Object.entries(p.overflow??{}).filter(([,n])=>n>0)
      .map(([id,n])=>[id,n,(p.bank[id]??0)>0])]);
    if((capacity.recoverableOverflow||recovery?.itemId!=null)&&p.enhance)
      return action(null,'等待当前强化完成后归仓','保留正在进行的强化尝试，完成后再处理溢出物品',recoveryFlags);
    if(recovery?.itemId!=null) {
      const carried=packQty(p,recovery.itemId);
      if(recovery.phase==='withdrawing'&&carried>=recovery.packBefore+1) {
        recovery.phase='returning';
        return atBank(p,{t:'depositItem',itemId:recovery.itemId,qty:1},'归还归仓触发物品',
          '只归还刚取出的 1 件，不出售、不丢弃任何物品',recoveryFlags);
      }
      if(recovery.phase==='returning'&&carried<=recovery.packBefore)
        recovery=capacity.recoverableOverflow?{key:overflowKey()}:null;
      else return waiting();
    }
    if(capacity.recoverableOverflow) {
      if(recovery?.key===overflowKey())return waiting();
      if(!planner.nearBank(p))return atBank(p,null,'溢出物品可归仓，先返回仓库','',recoveryFlags);
      if(p.route||p.path?.length)return action({t:'clearRoute'},'归仓前停止旧路线','等待停止确认后再操作仓库',recoveryFlags);
      const packSize=packUsed(data,p);
      const newKinds=Object.entries(p.overflow??{}).filter(([id,n])=>n>0&&!(p.bank[id]>0)).length;
      const donor=Object.entries(p.bank).find(([id,n])=>n>0&&data.items[planner.base(+id)]&&
        (n>1||(p.overflow?.[id]??0)>0||capacity.freeSlots>newKinds));
      if(!donor)return waiting();
      const itemId=Number(donor[0]),packBefore=packQty(p,itemId);
      if(packSize>=packCapacity(p)&&!(data.items[planner.base(itemId)].stackable&&packBefore>0)) {
        const depositable=p.pack.find(i=>(p.bank[i.itemId]??0)>0||capacity.freeSlots>0);
        if(depositable)return action({t:'depositItem',itemId:depositable.itemId,qty:depositable.qty},
          '归仓前腾出背包位置','只存入仓库当前能容纳的物品，再重新核对仓位',recoveryFlags);
      } else {
        // Native X9 calls ev after a withdrawal. Empty manual deposit (ov) does
        // not drain overflow, so borrow one known item and return exactly one.
        recovery={itemId,packBefore,phase:'withdrawing'};
        return action({t:'withdraw',itemId,qty:1},'触发溢出物品归仓','临时取出 1 件，归仓确认后立即放回',recoveryFlags);
      }
    }
    if(recovery)recovery=null;
    if(p.route?.errand&&!overflow)return null;
    if(!overflow&&p.coins>=capacity.coins&&finishTaskReason(data,p))return null;
    if(!overflow&&!upgrading&&!goal?.temporary&&!goal?.developmentFiller&&!goal?.itemTarget&&planner.professionUpgrade&&p.lastTick>=gearDeferredUntil&&
      (!goal?.development||goal.skill===professionSkill(style))&&
      (mode!=='business'||goal?.mainSkill===professionSkill(style))) {
      const gearPlan=planner.professionUpgrade(p,style,investmentGoal,{growth:goal?!!goal.growth:mode==='balanced',stage:goal?.stage});
      investmentGoal=gearPlan?.investmentGoal??null;
      if(gearPlan?.blocked||gearPlan?.deferUntilTick) {
        gearDeferredUntil=gearPlan.deferUntilTick??p.lastTick+Math.ceil(300000/data.tickMs);
      } else if(gearPlan) {
        if(goal?.enhancement&&investmentGoal?.upgrade?.slot===planner.equipmentStats(goal.enhancement.itemId)?.slot) {
          goal.budget.coins=Math.max(0,goal.budget.coins-goal.enhancement.gold);delete goal.enhancement;
        }
        return {...gearPlan,priorityGear:true};
      }
    }
    if(goal) {
      const funding=upgrading||goal.enhancementProject||goal.temporary||goal.developmentFiller||goal.itemTarget?null:investmentBudget(p,goal,style);
      if(funding) {
        goal.budget??={items:{},coins:0};goal.budget.coins=funding.coins;goal.enhancement=funding.enhancement;
      } else if(goal.enhancement&&!goal.enhancementProject) {
        goal.budget.coins=Math.max(0,goal.budget.coins-goal.enhancement.gold);delete goal.enhancement;
      }
    }
    const inspected=review(p,protection,style),reserve=inspected.budget;
    const capacitySale=autoSell!==true&&capacitySales===true&&capacity.freeSlots<=0;
    // A task chosen for its sale income sells those outputs even with everyday
    // selling off; the usual keep amounts and protections still apply.
    // Crafted training output above plan needs, working stock and reserves.
    // Of gear, one copy of the highest rarity that could still be an upgrade is
    // kept; other rarity/enhanced copies go to the market only.
    const craftedSurplus=sellCrafted===true&&autoSell!==true&&!capacitySale?
      inspected.items.filter(i=>i.sell>0&&(i.marketOnly||i.itemId===planner.base(i.itemId))&&craftedIds.has(planner.base(i.itemId))).map(i=>i.itemId):[];
    const profitItems=new Set([...(goal?.saleItems??[]),...craftedSurplus]);
    const profitSale=autoSell!==true&&!capacitySale&&profitItems.size>0;
    const saleFlags=capacitySale?{capacitySale:true}:profitSale?{profitSale:true}:{};
    const rows=autoSell===true||capacitySale?inspected.items.filter(i=>i.sell>0):
      profitSale?inspected.items.filter(i=>i.sell>0&&profitItems.has(i.itemId)):[];
    let deferredSale=null;
    const profit=rows.reduce((n,i)=>n+i.sellFromBank*i.vendorUnit,0);
    const urgent=reserve.pressure||p.coins<reserve.coins;
    // Small depot sales wait until a batch ends; clearing a productive route
    // would restart its supply plan even when the counter is next to the job.
    const detour=2*distance(p,bankFor(p))*data.tickMs/1000;
    const detourWorth=profit>=Math.max(200,detour*Math.max(1,goal?.rate?.coins??1));
    const idleAtBank=planner.nearBank(p)&&!p.route&&!p.path?.length;
    if(rows.length&&(idleAtBank||urgent||detourWorth)) {
      const bankRows=rows.filter(i=>i.sellFromBank>0).sort((a,b)=>
        (reserve.pressure?Number(b.sellFromBank===b.bank)-Number(a.sellFromBank===a.bank):0)||
        b.sellFromBank*b.vendorUnit-a.sellFromBank*a.vendorUnit);
      for(const row of bankRows) {
        if(row.marketOnly&&!planner.marketSale) {
          deferredSale=action(null,'装备出售待处理','品质／强化装备仅售市场，等待市场连接');continue;
        }
        const vendor=action({t:'marketDump',itemId:row.itemId,qty:row.sellFromBank,floor:row.vendorUnit},
          `出售盈余 · ${row.name} × ${row.sellFromBank}`,
          `${row.reason}；保留 ${row.keep}${row.marketOnly?'，等待同品质同强化成交报价':`，系统回收收入 ${row.sellFromBank*row.vendorUnit} 金币`}`,saleFlags);
        const sale=planner.marketSale?planner.marketSale(p,vendor,protection,style):vendor;
        if(sale?.marketDeferred){deferredSale=sale;continue;}
        if(!sale)continue;
        // Stop production only once an actual sale is ready, not while a quote
        // or a free listing slot is pending. Recheck stock on the next snapshot.
        if(sale.intent?.t==='marketDump') {
          if(planner.nearBank(p)&&(p.route||p.path?.length))return action(
            {t:'clearRoute'},'出售前停止路线并确认库存','下一份状态重新计算可卖数量，出售完成后继续收益规划',saleFlags);
          return atBank(p,sale.intent,sale.label,sale.reason,{...saleFlags,...(sale.illiquidSale?{illiquidSale:true}:{})});
        }
        return {...sale,...saleFlags};
      }
      const deposit=rows.find(i=>i.sellFromPack>0&&((p.bank[i.itemId]??0)>0||reserve.freeSlots>0));
      if(deposit) {
        if(p.route||p.path?.length||['walking','banking'].includes(p.activity))return deferredSale;
        return atBank(p,{t:'depositItem',itemId:deposit.itemId,qty:deposit.sellFromPack},
          `存入待售物品 · ${deposit.name}`,'只存入已确认可处理的盈余，再按最新库存计算卖出量',saleFlags);
      }
    }
    if(capacity.recoverableOverflow)return waiting();
    if(overflow&&(deferredSale||!rows.some(i=>i.bank>0&&i.sellFromBank===i.bank))) {
      if(goal?.itemTarget)return action(null,'物品目标等待仓库空间',
        '仓库剩余物品均受保护或正在等待成交；保留当前物品目标，整理后继续',{capacityLimited:true});
      // All remaining stock is protected. Continue a coin-only task without
      // creating new item kinds, rather than buying shelves or deleting valuables.
      const lv=planner.levels(p),choices=data.jobs.filter(j=>j.skill==='thieving'&&j.output.itemId===data.coinId&&
        !j.inputs.length&&j.levelReq<=lv.thieving&&(!j.bonus||(p.bank[j.bonus.itemId]??0)>0));
      choices.sort((a,b)=>b.output.qty/workEstimate(data,b,lv.thieving).seconds-
        a.output.qty/workEstimate(data,a,lv.thieving).seconds);
      const fixed=mode==='business'&&(mainJobId!=null||mainMonsterId!=null||goal?.fixedRecipeId!=null||goal?.fixedMonsterId!=null);
      const job=fixed?choices.find(j=>j.id===(mainJobId??goal?.fixedRecipeId)):choices[0];
      const site=job&&data.sites.find(s=>s.jobIds.includes(job.id));
      if(fixed&&!site)return action(null,'固定工作等待仓库空间','仓库空间不足；保留固定工作，等待整理或盈余成交后继续，不自动改做其他工作',{capacityLimited:true});
      if(site)return action(p.route?.jobId===job.id?null:
        {t:'setRoute',siteId:site.id,jobId:job.id,onFull:'bank',limit:0,rarity:0},
        fixed?'继续固定金币工作':'仓库保护 · 先赚金币',fixed?`继续所选 ${job.name}；此工作不新增物品种类，不更换固定目标`:!autoSell&&!capacitySale?'平时出售已关闭，库存留给玩家处理；先做不新增物品种类的任务':deferredSale?'市场物品等待成交；继续不新增物品种类的赚钱任务':
          '剩余库存均受保护；继续不新增物品种类的任务，保留稀有、种子及计划物资',
        {capacityLimited:true,...(p.ironman&&deferredSale?{reason:
          '铁人角色不能在玩家市场买卖普通物品；保留库存，请手动整理仓库，暂做不新增物品种类的工作'}:{})});
    }
    if(goal?.temporary||goal?.developmentFiller||goal?.itemTarget||upgrading)return deferredSale;
    if((mode==='balanced'||goal&&(goal.specialization||mode==='experience'))&&!goal?.upgrade) {
      const enhancement=planEnhancement(data,planner,p,style,{...goal,budget:reserve,
        specialization:mode!=='balanced'||!!goal?.development,mainSkill:goal?.mainSkill??goal?.skill});
      if(enhancement?.intent)return enhancement;
    }
    const upgrade=investment(p,goal,style,reserve);
    if(upgrade)return action({t:'enhance',itemId:upgrade.id,toPlus:1,once:true,worn:upgrade.slot},
      `强化在用装备 · ${data.items[planner.base(upgrade.id)].name} +1`,
      `首级成功率 100%；${upgrade.quote.gold} 金币、${upgrade.quote.shards} 碎片；`+
      `计入碎片价值，预计 ${(upgrade.paybackSeconds/60).toFixed(0)} 分钟回本，保留计划开销`,
      {investment:upgrade});
    return deferredSale;
  }
  function runtime(value) {
    if(value) ({lastGoal,lastPlayer,lastStyle,lastMode,lastMain,lastJob,lastMonster,investmentGoal,gearDeferredUntil,recovery}=value);
    return {lastGoal,lastPlayer,lastStyle,lastMode,lastMain,lastJob,lastMonster,investmentGoal,gearDeferredUntil,recovery};
  }
  return {runtime,maintenance,budget,review,investment,investmentBudget,setAutoSell:enabled=>{autoSell=enabled===true;},
    setCapacitySales:enabled=>{capacitySales=enabled===true;},setSellCrafted:enabled=>{sellCrafted=enabled===true;}};
}
