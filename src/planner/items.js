// Shared item, stock, pack, map and price arithmetic. Every module uses these
// instead of re-deriving them, so one rule has one definition.

// Item ids: base + rarity * rarityScale + enhancement * plusScale.
export const baseId=(data,id)=>id%data.plusScale%data.rarityScale;
export const rarityOf=(data,id)=>Math.floor(id%data.plusScale/data.rarityScale);
export const plusOf=(data,id)=>Math.floor(id/data.plusScale);
// Ids built from parts: the same base at another quality, the same item at
// another +N, and the item without its enhancement.
export const withRarity=(data,id,tier)=>baseId(data,id)+tier*data.rarityScale;
export const withPlus=(data,id,plus)=>id%data.plusScale+plus*data.plusScale;
export const unenhanced=(data,id)=>id%data.plusScale;
export const isEnhanced=(data,id)=>id>=data.plusScale;
export const RARITY_NAMES=['','罕见','稀有','史诗','传说'];
// A quality's name; common is "普通" where a name is needed.
export const qualityName=tier=>RARITY_NAMES[tier]||'普通';
export const qualityPrefix=(data,id)=>RARITY_NAMES[rarityOf(data,id)]?`${RARITY_NAMES[rarityOf(data,id)]} `:'';
// Name of the base item; a product without an item row is named after its job.
export const itemName=(data,id)=>data.items[baseId(data,id)]?.name??
  data.jobs.find(j=>j.output.itemId===baseId(data,id))?.name??`物品 ${id}`;
// Display name with quality and enhancement, e.g. "史诗 Steel blade +2".
export const itemLabel=(data,id,name=itemName(data,id))=>
  `${qualityPrefix(data,id)}${name}${isEnhanced(data,id)?` +${plusOf(data,id)}`:''}`;
// The same base in each quality from `from` to `to` (inclusive).
export const qualityIds=(data,id,from=0,to=data.rarityMultipliers.length-1)=>
  Array.from({length:to-from+1},(_,i)=>baseId(data,id)+(from+i)*data.rarityScale);

// Stock of one exact id. Bank, pack and overflow storage; worn items and coins
// are separate. Overflow is owned but cannot be withdrawn until storage frees
// up: it counts toward what is owned (stockQty, ownedQty), never toward what
// can be used now (usableQty, planner.count, stockMap).
export const packQty=(p,id)=>p.pack.reduce((n,i)=>i.itemId===id?n+i.qty:n,0);
export const shelfQty=(p,id)=>(p.bank[id]??0)+(p.overflow?.[id]??0);
export const stockQty=(p,id)=>shelfQty(p,id)+packQty(p,id);
export const usableQty=(p,id)=>(p.bank[id]??0)+packQty(p,id);
// Within reach right now: the pack, plus the bank when standing at it.
export const reachableQty=(data,p,id)=>packQty(p,id)+(nearBank(data,p)?p.bank[id]??0:0);
export const wornQty=(p,id)=>Object.values(p.equipment??{}).filter(worn=>worn===id).length;
// Owned in all: stock (overflow included), worn pieces and market listings.
export const ownedQty=(p,id,listed=0)=>stockQty(p,id)+wornQty(p,id)+listed;
// id -> quantity usable now (bank and pack); with overflow when asked.
export function stockMap(p,{overflow=false}={}) {
  const stock={...p.bank};
  for(const item of p.pack)stock[item.itemId]=(stock[item.itemId]??0)+item.qty;
  if(overflow)for(const [id,n]of Object.entries(p.overflow??{}))stock[id]=(stock[id]??0)+n;
  return stock;
}
// Every id held once: banked (quantity above 0) and carried, worn when asked.
export const heldIds=(p,{worn=false}={})=>[...new Set([...Object.keys(p.bank).filter(id=>p.bank[id]>0).map(Number),
  ...p.pack.map(i=>i.itemId),...(worn?Object.values(p.equipment??{}).filter(Number.isFinite):[])])];
// The same player holding none of `id`: output already made is not material.
export const withoutItem=(p,id)=>({...p,bank:{...p.bank,[id]:0},pack:p.pack.filter(i=>i.itemId!==id)});

// Pack space: 28 slots plus the pockets perk; a stackable kind takes one slot.
export const packCapacity=p=>28+Math.max(0,Math.floor(p.perks?.pockets??0));
export const packUsed=(data,p)=>p.pack.reduce((n,i)=>n+(data.items[baseId(data,i.itemId)]?.stackable?1:i.qty),0);
export const packFree=(data,p)=>packCapacity(p)-packUsed(data,p);
// Food taken per trip: -1 fills the pack, -2 leaves one slot, else the set count.
export const foodCarry=(p,capacity=packCapacity(p))=>
  p.foodPerTrip===-1?capacity:p.foodPerTrip===-2?Math.max(1,capacity-1):p.foodPerTrip??20;

// The player's own queued or set-aside work comes first: nothing is started over it.
export const playerQueued=p=>!!(p.held||p.raidHeld||p.queue?.length);

// Map: tiles are Chebyshev distance apart; "at the bank" is within one tile.
export const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
export const nearestBank=(data,point)=>[...data.banks].sort((a,b)=>distance(point,a)-distance(point,b))[0];
export const nearBank=(data,p)=>data.banks.some(b=>distance(p,b)<=1);
// A mount's bonus scales by its own quality and +N table, not the other gear's.
const MOUNT_QUALITY=[1,1.5,2.25,3.5,5],MOUNT_PER_PLUS=.15;
export const mountScale=(data,id)=>(MOUNT_QUALITY[rarityOf(data,id)]??1)*(1+MOUNT_PER_PLUS*plusOf(data,id));
// Walking stride (x1000 per tick) before potions: the mount's scaled bonus and
// the move mastery. Rounded by callers.
export function baseStride(data,p) {
  const mount=p.equipment?.mount??0,g=data.gear.find(g=>g.itemId===baseId(data,mount)&&g.slot==='mount');
  const bonus=(g?.bonus??0)*mountScale(data,mount);
  return (1000+Math.round(bonus*1000))*(1+.005*(p.masteries?.move??0));
}
// The bank the game's own routes use: the home bank, else the nearest one.
export const homeBank=(data,p,from=p)=>data.banks.find(b=>b.id===p.homeBank)??nearestBank(data,from);
// Seconds for a round trip from `from` to that bank's approach and back, at
// the base stride (a mount shortens it; potions are left out).
export function bankTripSeconds(data,p,from=p) {
  const bank=homeBank(data,p,from);
  return 2*distance(from,bank.approach??bank)*data.tickMs/Math.round(baseStride(data,p));
}

// Prices: the merchant pays 40% of base value (at least 1); market sales pay
// the tax in basis points; a listing must clear the floor after tax.
// Coal fuels every bar at every quality (rarity recipes keep it common), so
// common coal is never sold or converted; rarer coal is only worth house points.
export const COAL_ID=5;
// Base items that can be sold at all: not coins, not the four untradable
// special items, and worth something (burnt food 70 sells for scrap).
export const tradableBase=(data,base)=>base!==data.coinId&&![294,295,296,297].includes(base)&&
  (data.items[base]?.value>0||base===70);
// The game's shop (client m7, index-BqokRC4i, less its alchemy-only lines)
// sells these common-quality items without limit: seeds at four times base
// value, bronze tools, cooked shrimp and the horse at twice, firework powder
// (700) at 5000. Nobody pays a player more than the shop asks.
const SHOP_FACTORS={160:4,161:4,162:4,190:4,60:2,80:2,85:2,90:2,328:2},SHOP_FIXED={700:5000};
export const SHOP_ITEM_IDS=new Set([...Object.keys(SHOP_FACTORS),...Object.keys(SHOP_FIXED)].map(Number));
export const shopPrice=(data,id)=>SHOP_FIXED[id]??(SHOP_FACTORS[id]&&data.items[id]?.value>0?data.items[id].value*SHOP_FACTORS[id]:null);
// The vendor sells the starter seed (sage, 190) at four times base value.
export const SEED_ID=190;
export const seedVendorPrice=data=>shopPrice(data,SEED_ID)??0;
export const merchantPrice=(data,id)=>Math.max(1,Math.floor((data.items[baseId(data,id)]?.value??0)*.4));
export const netProceeds=(price,qty,taxBp)=>price*qty-Math.floor(price*qty*taxBp/10000);
export const minListPrice=(floor,taxBp)=>Math.floor(floor/(1-taxBp/10000))+1;
// Time: a tick lasts data.tickMs.
export const dayTicks=data=>86400000/data.tickMs;
export const dayIndex=(data,tick)=>Math.floor(tick/dayTicks(data));
export const ticksToSeconds=(data,ticks)=>ticks*data.tickMs/1000;
export const secondsToTicks=(data,seconds)=>Math.ceil(seconds*1000/data.tickMs);
export const msToTicks=(data,ms)=>Math.ceil(ms/data.tickMs);
export const ticksToMinutes=(data,ticks)=>ticks*data.tickMs/60000;
