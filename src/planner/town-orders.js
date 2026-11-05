// Town orders (城镇 → 订单, client 0.0.0929): three a day, the same for everyone,
// drawn from the day number; each asks for N of one item, delivered from the
// bank at a depot counter ({t:'contract', slot}), once per day, and pays ten
// times what the vendor gives. Which slots are delivered today comes with the
// welcome frame and the `contracts` message (player.contracts {day, done}).
//
// One order is worth taking when its pay beats making it (the shared payback
// rule, gold as time at the gold rate): the work's time, the inputs it buys,
// and the held pieces it hands in at what using them gives up (stockValue).
// It then runs as a quest-shaped goal (`quest.period === 'order'`), through the
// same goal path as quests, and is handed in once the bank holds the pieces.
import {goldToSeconds, pays} from './gold.js';
import {dayTicks, merchantPrice, packQty} from './items.js';

// Client y$, g_ and bc: tiers by recipe level, each worth about `worth` at
// the vendor; one recipe per tier by a seeded hash of the day.
export const ORDER_TIERS=[{min:1,max:15,worth:400},{min:16,max:40,worth:1500},{min:41,max:75,worth:4000}];
const ORDER_SEED=1129270868,ORDER_PAY=10;
const CLIENTS=['The inn','The mill','The smith','The lighthouse keeper','The quarry master','The ferryman','The chandler','The brewer','The mine lift crew','The fletcher'];
const UNTRADABLE=new Set([294,295,296,297,762]),UNTRADABLE_LINE=new Set([45,46,47,48,49,50,51,52,53,54,55,71,72,73,74,75,76,77,78]);
// Recipes using these (client $0) never make an order.
const SPECIAL_INPUTS=new Set([53,78,700]);
const VENDOR_FACTOR={207:.8};

export function orderHash(c,o,e) {
  let a=(c^2654435769)>>>0;
  a=Math.imul(a^(o>>>0),2246822507)>>>0;a=(a^(a>>>13))>>>0;
  a=Math.imul(a^(e>>>0),3266489909)>>>0;a=(a^(a>>>16))>>>0;
  return a>>>0;
}
const vendorPrice=(data,id)=>VENDOR_FACTOR[id]?Math.max(1,Math.floor(merchantPrice(data,id)*VENDOR_FACTOR[id])):merchantPrice(data,id);
const tradable=(data,id)=>id!==data.coinId&&(data.items[id]?.value??0)>0&&!UNTRADABLE.has(id)&&!UNTRADABLE_LINE.has(id%1000);

// The board for day `day`: [{slot, itemId, qty, coins, client, jobId}].
export function townOrders(data,day) {
  return ORDER_TIERS.map((tier,slot)=>{
    const pool=data.jobs.filter(j=>!j.grow&&j.skill!=='thieving'&&!j.inputs.some(i=>SPECIAL_INPUTS.has(i.itemId))&&
      j.levelReq>=tier.min&&j.levelReq<=tier.max&&tradable(data,j.output.itemId));
    let pick=pool[0],best=-1;
    for(const j of pool){const h=orderHash(day,slot*100003+j.id,ORDER_SEED);if(h>best){best=h;pick=j;}}
    if(!pick)return null;
    const itemId=pick.output.itemId,qty=Math.max(5,Math.min(250,Math.round(tier.worth/data.items[itemId].value)));
    return {slot,itemId,qty,coins:vendorPrice(data,itemId)*qty*ORDER_PAY,client:CLIENTS[orderHash(day,slot+7,ORDER_SEED)%CLIENTS.length],jobId:pick.id};
  }).filter(Boolean);
}

export function createTownOrders(data,planner) {
  const dayOf=p=>Math.floor(p.lastTick/dayTicks(data));
  const held=(p,id)=>(p.bank?.[id]??0)+packQty(p,id);
  // Today's orders: delivered (null while the server has not said), held pieces.
  function read(p) {
    if(!Number.isFinite(p?.lastTick))return [];
    const day=dayOf(p),done=p.contracts?.day===day&&Array.isArray(p.contracts.done)?p.contracts.done:null;
    return townOrders(data,day).map(o=>({...o,day,key:`order:${day}:${o.slot}`,delivered:done?done.includes(o.slot):null,held:held(p,o.itemId)}));
  }
  // What an order is worth: its pay against making it, as time at the gold rate.
  function value(p,o,style='magic',levels=planner.levels(p)) {
    const job=data.jobs.find(j=>j.id===o.jobId);
    if(!job||levels[job.skill]<job.levelReq)return {...o,reason:'配方等级不足'};
    if(!data.sites.some(s=>s.jobIds.includes(job.id)))return {...o,reason:'没有可用地点'};
    const coinRate=planner.coinRate?.(p)??0,have=Math.min(o.qty,o.held),rest=o.qty-have;
    const estimate=rest>0?planner.routeEstimate(p,job,rest,{style,buyInputs:true,credit:false}):
      {seconds:0,coins:0,budget:{coins:0,items:{}},recipes:{[job.skill]:job.id},supplyRecipes:{},purchases:{}};
    // Held stock, the pieces and the inputs the route uses up (estimate.owned),
    // costs what using it gives up, as the gold table counts it.
    const stock=(id,qty)=>qty>0?(planner.stockValue??planner.saleValue)(p,id,Math.max(1,Math.round(qty)))*qty:0;
    const heldGold=stock(o.itemId,have)+(planner.ownedGold?.(p,estimate)??0);
    const seconds=estimate.seconds,left=((o.day+1)*dayTicks(data)-p.lastTick)*data.tickMs/1000;
    const paid=seconds+goldToSeconds(Math.max(0,-(estimate.coins??0))+heldGold,coinRate),saved=goldToSeconds(o.coins,coinRate);
    const base={...o,job,rest,estimate,seconds,paid,saved,net:saved-paid};
    if(!Number.isFinite(seconds))return {...base,reason:'没有可行的供料路线'};
    if(seconds>left)return {...base,reason:'刷新前做不完'};
    return {...base,worth:pays(saved,paid),reason:pays(saved,paid)?null:
      `不回本：报酬 ${o.coins.toLocaleString()} 金币约 ${(saved/60).toFixed(0)} 分钟，做这单约 ${(paid/60).toFixed(0)} 分钟`};
  }
  // The most worthwhile open order as a goal (quest-shaped, so it runs through
  // the quests' goal path), or null. Unknown deliveries are not guessed.
  function chooseGoal(p,baseline,style='magic',deferred={}) {
    const levels=planner.levels(p);
    const rows=read(p).filter(o=>o.delivered===false&&!deferred[o.key]).map(o=>value(p,o,style,levels))
      .filter(r=>r.worth).sort((a,b)=>b.net-a.net);
    const r=rows[0];
    if(!r)return null;
    const {job,estimate}=r,left=((r.day+1)*dayTicks(data)-p.lastTick)*data.tickMs/1000;
    return {skill:job.skill,recipeId:job.id,batch:r.rest,target:levels[job.skill]+1,stage:baseline?.stage,growth:true,
      quest:{key:r.key,id:`order:${r.slot}`,period:'order',stamp:r.day,kind:job.inputs.length?'craft':'gather',jobId:job.id},
      order:{slot:r.slot,day:r.day,itemId:r.itemId,qty:r.qty,coins:r.coins},
      rate:{xp:(estimate.xp??0)/Math.max(1,r.seconds),coins:r.coins/Math.max(1,r.seconds)},
      // The pieces are reserved for the order: maintenance never sells them.
      budget:{coins:estimate.budget?.coins??0,items:{...estimate.budget?.items,[r.itemId]:r.qty}},
      recipes:{...estimate.recipes,[job.skill]:job.id},supplyRecipes:estimate.supplyRecipes,
      horizon:Math.min(left,Math.max(1800,r.seconds*2)),estimate,
      reason:`城镇订单 · ${r.qty} × ${data.items[r.itemId].name}：报酬 ${r.coins.toLocaleString()} 金币，`+
        `做这单约 ${Math.ceil(r.paid/60)} 分钟（含所用库存和购料）${r.held?`，已有 ${Math.min(r.held,r.qty)}`:''}`};
  }
  const completed=(p,goal)=>!!goal?.order&&(dayOf(p)!==goal.order.day||p.contracts?.day===goal.order.day&&p.contracts.done?.includes(goal.order.slot));
  // Hand-in: the pieces in the bank, at a depot counter.
  const ready=(p,goal)=>!!goal?.order&&(p.bank?.[goal.order.itemId]??0)>=goal.order.qty;
  // For the panel: every order today with its verdict.
  function overview(p,style='magic',deferred={}) {
    return read(p).map(o=>{
      const base={key:o.key,slot:o.slot,client:o.client,itemId:o.itemId,qty:o.qty,coins:o.coins,held:o.held};
      if(o.delivered)return {...base,status:'今日已上交'};
      if(o.delivered===null)return {...base,status:'等待游戏告知今日上交情况'};
      if(deferred[o.key])return {...base,status:'暂缓，稍后重新安排'};
      const v=value(p,o,style);
      return {...base,status:v.worth?'值得，会做':v.reason,minutes:Number.isFinite(v.paid)?Math.ceil(v.paid/60):null};
    });
  }
  return {read,value,chooseGoal,completed,ready,overview};
}
