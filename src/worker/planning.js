import {createEnhancementTraining} from '../planner/enhancement.js';
import {createPlanner} from '../planner/planner.js';
import {createEconomy} from '../economy/economy.js';
import {createMarket} from '../economy/market.js';
import {normalizeHotFollow} from '../runtime/hot-follow.js';
import {Trainer} from '../runtime/trainer.js';
import {engineApi, engineRates, engineReady, engineStatus, loadEngine, mergeRates} from '../engine/runtime.js';
import {chooseMastery} from '../engine/mastery.js';

// Only the decision phase is transferable. The page owns the socket, receipts,
// transaction journal, Boss lifecycle and every actual command submission.
export const decisionFields=['goal','served','deferred','questDeferred','waitingGoals','blockedReasons','sequence',
  'goalSince','bankedLoad','message','plan','history','farmJobId','progress','stallCheck','failures','failureKey','itemTarget','buffRefill',
  'hotFollow','hotParkedGoal','hotFollowValidation'];
export const inputFields=[...decisionFields,'player','active','style','mode','mainTrade','mainJobId','mainMonsterId','softRefused',
  'snapshotSequence','syncAfter','nextSync','lastSync'];
export const planningState=trainer=>Object.fromEntries(inputFields.map(key=>[key,trainer[key]]));

export function planningGuard(trainer,planner,market,settings) {
  return JSON.stringify([planningState(trainer),trainer.pending,trainer.recovery,trainer.awaitInitial,
    trainer.boss.status(),planner.farmingPreference(),planner.housingRuntime?.(),market.runtime(),settings],(key,value)=>
    // A heartbeat alone does not invalidate an otherwise identical decision.
    key==='lastTick'||key==='snapshotTick'||key==='snapshotSequence'||key==='syncAfter'||key==='nextSync'||key==='lastSync'?undefined:
      value instanceof Map?[...value]:value);
}

export function runPlanning(data,input,inspectOnly=false) {
  const planner=createPlanner(data),writes={};
  const storage={getItem:key=>input.storage[key]??null,setItem:(key,value)=>{
    if(input.storageUnavailable)throw new Error('网站存储不可用');
    input.storage[key]=value;writes[key]=value;
  }};
  planner.runtime(input.planner);
  planner.profitFloor=input.settings.profitFloor??0;
  // The game's own engine (when loaded) calibrates every candidate; real
  // measurements of the current route still take precedence.
  if(input.engine)loadEngine(input.engine);
  const simulated=engineReady()&&input.trainer?.player?engineRates(data,planner,input.trainer.player,{budgetMs:500}):{};
  planner.setMeasurements(mergeRates(simulated,input.rates));
  // Mastery points can only be counted and valued by the engine.
  if(engineApi())planner.masteryPurchase=(p,goal)=>chooseMastery(engineApi(),p,
    goal&&{...goal,inputs:data.jobs.find(j=>j.id===goal.recipeId)?.inputs??[]},
    {metric:goal?.specialization&&goal.rate?.coins>0?'coins':'xp'});
  planner.enhancementTraining=createEnhancementTraining(data,planner,{
    read:()=>{try{return JSON.parse(storage.getItem('deepvein-enhancement-training-v1')||'null');}catch{return null;}},
    write:value=>storage.setItem('deepvein-enhancement-training-v1',JSON.stringify(value))});
  const economy=createEconomy(data,planner,input.settings),market=createMarket(data,planner,{...input.settings,storage,now:()=>input.now});
  economy.runtime(input.economy);market.runtime(input.market);
  planner.maintenance=(...args)=>economy.maintenance(...args);
  planner.investmentBudget=(...args)=>economy.investmentBudget(...args);
  for(const [name,method]of Object.entries({marketSale:'sale',marketPurchase:'purchase',marketOpportunity:'opportunity',
    watchMarket:'watch',marketEquipment:'equipmentPurchase',marketFood:'foodPurchase',marketBuffFood:'buffFood',
    potionDose:'potionDose',marketAllowance:'purchaseAllowance',marketUnitCost:'marketUnitCost',marketSurplusValue:'surplusValue',watchPurchases:'watchPurchases'}))
    planner[name]=(...args)=>market[method](...args);
  planner.restockPotion=(...args)=>input.settings.potionRestock?market.restockPotion(...args):null;
  planner.potionStatus=(...args)=>input.settings.potionRestock?market.potionStatus(...args):{key:'procurement-off',message:'药水未喝：库存不足，自动补药已关闭'};
  planner.watchPotions=(p,ids)=>market.watchPotions(p,input.settings.potionRestock?ids:[]);
  const commands=[],trainer=new Trainer(data,planner,intent=>commands.push(intent),()=>input.now);
  Object.assign(trainer,input.trainer);
  trainer.hotFollow=normalizeHotFollow(input.settings.hotFollow??trainer.hotFollow);
  trainer.hotParkedGoal=input.trainer.hotParkedGoal??null;
  trainer.market=market;
  trainer.boss={status:()=>input.boss,cancel:()=>{}};
  let proposal=null;
  trainer.issue=plan=>{proposal=trainer.prepareIssue(plan);trainer.plan=proposal;};
  if(!inspectOnly)trainer.advance(input.deferBoss);
  const p=trainer.player;
  const view={
    review:input.details.inventory?economy.review(p,trainer.goal,trainer.style):null,
    equipment:input.details.equipment?planner.equipmentStatus(p,trainer.style):null,
    growth:trainer.mode==='balanced'?planner.growthStatus(p,trainer.style,trainer.deferred):null,
    business:trainer.mode==='business'?planner.specializationStatus(p,trainer.style,trainer.mainTrade,trainer.mainJobId,trainer.mainMonsterId):null,
    farming:planner.farmStatus(p)
  };
  return {decision:Object.fromEntries(decisionFields.map(key=>[key,trainer[key]])),active:trainer.active,proposal,commands,
    sync:{syncAfter:trainer.syncAfter,nextSync:trainer.nextSync,lastSync:trainer.lastSync},
    planner:planner.runtime(),economy:economy.runtime(),market:market.runtime(),writes,view,
    engine:{...engineStatus(),simulated:Object.keys(simulated).length}};
}

export function applyPlanning(trainer,planner,economy,market,result,storage) {
  if(!result.active)trainer.pause(result.decision.message);
  for(const [key,value]of Object.entries(result.writes)) {
    if(!['deepvein-market-v1','deepvein-enhancement-training-v1'].includes(key))throw new Error('未知规划存储项');
    storage.setItem(key,value);
  }
  planner.runtime(result.planner);economy.runtime(result.economy);market.runtime(result.market);
  for(const key of decisionFields)trainer[key]=result.decision[key];
  // The Worker can request a fresh snapshot, never open a game connection.
  for(const intent of result.commands) {
    if(intent.t!=='resync')throw new Error('未知后台查询');
    trainer.send(intent);trainer.syncAfter=trainer.snapshotSequence;
    trainer.nextSync=result.sync.nextSync;trainer.lastSync=result.sync.lastSync;
  }
  if(result.proposal&&trainer.active)trainer.issue(result.proposal,true);
}

// One outstanding calculation, with a page-side watchdog. Terminating a wedged
// Worker leaves the game's native route untouched and never replays a command.
export function createPlanningClient(makeWorker,{timeout=8000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let worker=null,pending=null,sequence=0;
  function close(error=new Error('后台规划已取消')) {
    worker?.terminate();worker=null;
    if(pending){clearTimer(pending.timer);const {reject}=pending;pending=null;reject(error);}
  }
  function request(kind,input) {
    if(pending)return Promise.reject(new Error('后台规划仍在进行'));
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      try {
        if(!worker) {
          worker=makeWorker();
          worker.onmessage=({data})=>{
            if(data.id!==pending?.id)return;
            clearTimer(pending.timer);const task=pending;pending=null;
            if(data.error)task.reject(new Error(data.error));else task.resolve(data.result);
          };
          worker.onerror=()=>close(new Error('后台规划线程异常'));
          worker.onmessageerror=()=>close(new Error('后台规划结果无法读取'));
        }
        pending={id,resolve,reject,timer:setTimer(()=>close(new Error('后台计算超过 8 秒，已终止本次计算')),timeout)};
        worker.postMessage({id,kind,input});
      }catch(error){close(error);reject(error);}
    });
  }
  return {request,close,get busy(){return !!pending;}};
}
