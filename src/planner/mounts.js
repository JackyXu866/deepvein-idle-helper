// Mounts: the merchant's common Horse, and breeding (client: at the storage
// counter, ten mounts of one quality, lowest +N first, give one of the next
// quality at +0; legendary is the last). One rule prices a mount of any
// quality (`mountSupply`: held lower mounts, the market, the merchant, or
// ten of the quality below, whichever is cheaper at each step), and one step
// acts on that same plan (`mountSupplyStep`). The investment table reads the
// price, the gear step the step.
import {LEGENDARY} from './quality.js';
import {ENHANCEMENT_MAX} from './inventory.js';
import {baseId, itemLabel, qualityName, rarityOf, withPlus, withRarity} from './items.js';
import {goldToSeconds} from './gold.js';
import {action} from './result.js';

export const HORSE_ID=328,BREED_COUNT=10,HORSE_VENDOR_LEVEL=150,VENDOR_MAX=100;
// The merchant sells the common Horse at twice its base value, from total level 150.
export const horseVendorPrice=data=>(data.items[HORSE_ID]?.value??0)*2;
export const isMount=(data,id)=>data.gear.some(g=>g.itemId===baseId(data,id)&&g.slot==='mount');
export const totalLevel=(planner,p)=>Object.values(planner.levels(p)).reduce((n,l)=>n+l,0);
export const horseVendor=(data,planner,p)=>horseVendorPrice(data)>0&&totalLevel(planner,p)>=HORSE_VENDOR_LEVEL;

// The cheapest way to have `n` more of mount `id` (+0) on the shelf: gold,
// and the plan (held lower mounts used, bought at the merchant, bought on
// the market, bred per source quality). Held lower mounts count at what they
// would sell for (planner.stockValue; protected mounts give up nothing).
// Breeding draws on the bank (the storage counter), never the worn mount.
export function mountSupply(data,planner,p,id,n=1,coinRate=planner.coinRate?.(p)??0) {
  const base=baseId(data,id),pool={};
  const cost=o=>o.seconds+goldToSeconds(o.gold,coinRate);
  const have=q=>pool[q]??=Math.max(0,p.bank?.[q]??0);
  function get(tier,want,top) {
    const plan={gold:0,seconds:0,held:{},vendor:0,market:{},breed:{}};
    let left=want;
    // Held copies of a lower quality first, lowest +N first (the game's order).
    if(!top)for(let plus=0;plus<=ENHANCEMENT_MAX&&left>0;plus++) {
      const q=withPlus(data,withRarity(data,base,tier),plus),k=Math.min(have(q),left);
      if(k>0){pool[q]-=k;left-=k;plan.held[q]=k;plan.gold+=k*(planner.stockValue?.(p,q,1)??0);}
    }
    if(!left)return plan;
    const unit=withRarity(data,base,tier),options=[],ask=planner.marketAsk?.(p,unit);
    // The merchant first: on a tie it wins (its stock has no end, a listing's does).
    if(tier===0&&base===HORSE_ID&&horseVendor(data,planner,p))options.push({gold:left*horseVendorPrice(data),seconds:0,vendor:left});
    if(ask>0)options.push({gold:left*ask,seconds:0,market:{[unit]:{qty:left,price:ask}}});
    if(tier>0) {
      const saved={...pool},sub=get(tier-1,left*BREED_COUNT,false),after={...pool};
      Object.assign(pool,saved);
      if(Number.isFinite(sub.gold))options.push({...sub,breed:{...sub.breed,[tier-1]:left},pool:after});
    }
    const best=options.sort((a,b)=>cost(a)-cost(b))[0];
    if(!best)return {...plan,gold:Infinity};
    if(best.pool)Object.assign(pool,best.pool);
    return {gold:plan.gold+best.gold,seconds:plan.seconds+best.seconds,held:{...plan.held,...best.held},
      vendor:best.vendor??0,market:{...best.market},breed:{...best.breed}};
  }
  const plan=get(rarityOf(data,id),n,true);
  const bred=Object.values(plan.breed).some(t=>t>0);
  return {...plan,source:bred?'繁育':plan.vendor>0?'商人':Object.keys(plan.market).length?'市场':'已持有'};
}

// The next command toward mount `id` (+0) by that plan, lowest quality first:
// the merchant's horses (100 a time), the market's mounts, then breeding.
// Starts only when the whole remaining plan is affordable, so a half-bred
// chain never strands the gold; every step re-plans from the bank.
export function mountSupplyStep(data,planner,p,goal,profession,id,{label,bankAction,need=0}) {
  const plan=mountSupply(data,planner,p,id);
  if(!Number.isFinite(plan.gold))return null;
  // `need`: the whole option's gold (the enhancing after it included).
  const allowance=planner.marketAllowance?.(p,goal)??Math.max(0,p.coins);
  if(Math.max(plan.gold,need)>allowance)return null;
  const base=baseId(data,id),why=`${label}：${plan.source} 约 ${Math.round(plan.gold).toLocaleString()} 金币`;
  for(let tier=0;tier<=rarityOf(data,id);tier++) {
    const unit=withRarity(data,base,tier);
    if(tier===0&&plan.vendor>0) {
      const qty=Math.min(VENDOR_MAX,plan.vendor,Math.floor(Math.max(0,p.coins)/horseVendorPrice(data)));
      if(qty<1)return null;
      return {...bankAction(p,{t:'vendorBuy',itemId:HORSE_ID,qty},`商人购买 ${itemLabel(data,HORSE_ID)} × ${qty}`),
        reason:`${why}；商人单价 ${horseVendorPrice(data).toLocaleString()}，还需 ${plan.vendor} 匹`};
    }
    const buy=plan.market[unit];
    if(buy) {
      const market=planner.marketEquipment?.(p,goal,profession,{ids:[base],row:{id:unit,qty:buy.qty,gold:buy.price,
        label:`${label} · 买 ${itemLabel(data,unit)} × ${buy.qty}`,paid:goldToSeconds(plan.gold,planner.coinRate?.(p)??0),saved:0,gain:0}});
      return market?.intent||market?.marketWaiting?market:null;
    }
    const times=plan.breed[tier]??0;
    if(times>0&&tier<LEGENDARY) {
      // Ten of this quality are on the shelf for each breed (bought or bred below).
      const shelf=Array.from({length:ENHANCEMENT_MAX+1},(_,plus)=>p.bank?.[withPlus(data,unit,plus)]??0).reduce((a,b)=>a+b,0);
      const now=Math.min(times,Math.floor(shelf/BREED_COUNT));
      if(now<1)return null;
      return {...bankAction(p,{t:'breedMounts',itemId:unit,times:now},`繁育 ${BREED_COUNT * now} 匹${qualityName(tier)}坐骑 → ${now} 匹${qualityName(tier+1)}`),
        reason:`${why}；每 ${BREED_COUNT} 匹${qualityName(tier)}（先用 +N 最低的）换 1 匹${qualityName(tier+1)} +0`};
    }
  }
  return null;
}
// The breeding plan's own validation: a mount, a quality below legendary,
// and ten of it on the shelf per breed (the page's safety check).
export function validBreed(data,p,intent) {
  if(Object.keys(intent).length!==3||!Number.isSafeInteger(intent.itemId)||!isMount(data,intent.itemId)||
    intent.itemId!==withRarity(data,intent.itemId,rarityOf(data,intent.itemId))||rarityOf(data,intent.itemId)>=LEGENDARY||
    !Number.isInteger(intent.times)||intent.times<1)return false;
  const shelf=Array.from({length:ENHANCEMENT_MAX+1},(_,plus)=>p.bank?.[withPlus(data,intent.itemId,plus)]??0).reduce((a,b)=>a+b,0);
  return shelf>=BREED_COUNT*intent.times;
}
// Mounts of quality `itemId` held anywhere (bank, pack): what breeding takes
// and gives, for the trainer's confirmation.
export const mountsOfQuality=(data,quantity,p,itemId)=>
  Array.from({length:ENHANCEMENT_MAX+1},(_,plus)=>quantity(p,withPlus(data,itemId,plus))).reduce((a,b)=>a+b,0);
