import {autoUsableMaterial, buyableItem, pricePerEffect, rarityPower, usableQualities} from '../planner/quality.js';
import {action, waiting} from '../planner/result.js';
import {POTIONS, foodEffects, foodHealing} from '../planner/supplies.js';
import {ENHANCEMENT_MAX, coinReserve, enhanceQuote, inventoryBudget, reviewInventory, saleProtectionReason} from '../planner/inventory.js';
import {expectedEnhancement} from '../planner/investment.js';
import {goldToSeconds, maxPrice, pays, secondsToGold} from '../planner/gold.js';
import {bankTripSeconds, dayTicks as dayTicksOf, playerQueued, distance, itemLabel, itemName, merchantPrice, minListPrice, netProceeds, plusOf, rarityOf, reachableQty, shopPrice, stockQty, tradableBase} from '../planner/items.js';
import {MARKET_HISTORY_KEY, createMarketHistory} from './market-history.js';

// Price grid (client Nb/Vn/ih/Zm; refusal 'market-price-step'): a price must be
// a multiple of a step that grows with it: 1 below 100, then 2, 5 or 10 times
// one hundredth of its power of ten (20 at 1,000-1,999; 1,000 at 50,000-99,999).
export function priceStep(price) {
  if(price<100)return 1;
  const power=10**(String(Math.floor(price)).length-1),unit=power/100;
  return price<2*power?2*unit:price<5*power?5*unit:10*unit;
}
export const onPriceStep=price=>Number.isInteger(price)&&price>0&&price%priceStep(price)===0;
// The highest valid price strictly below `price` (the client's undercut).
export function stepBelow(price) {
  const below=price-1;if(below<1)return 1;
  const step=priceStep(below);return Math.max(1,Math.floor(below/step)*step);
}
export const priceDown=price=>onPriceStep(price)?price:stepBelow(price);
export function priceUp(price) {
  if(onPriceStep(price))return price;
  const step=priceStep(price);return (Math.floor(price/step)+1)*step;
}

// Limit orders can rest after a partial fill. Track only orders we submitted;
// inventory removed into escrow is not evidence of a sale or realized income.
export function createMarket(data,planner,{now=Date.now,storage=null,historyStorage=null,autoSell=false,capacitySales=false}={}) {
  const key='deepvein-market-v1',ttl=15000,waitMs=4000,coolMs=30000;
  // One cadence for the helper's own listings: reviewed (re-priced, merged,
  // giving up a slot) and one sale per item every three hours. Thirty minutes
  // cancelled and re-listed too often.
  const reviewMs=3*3600000,recycleMs=7200000;
  // The player market is closed to an ironman, and to an account the game
  // refuses for having no verified email (email-needed). That refusal is kept
  // per character for six hours (or until the game reports the email
  // verified); then one order tries again.
  const gateMs=6*3600000;
  const closed=p=>!!p&&(p.ironman===true||(saved.players[p.id]?.tradeGateUntil??0)>now());
  const closedReason=p=>p.ironman?'铁人角色不支持普通玩家市场交易；保留盈余，请手动整理仓库':
    '账号没有验证过的邮箱，游戏不允许市场交易；保留盈余，按自给规划（在游戏“账号”里验证邮箱后自动恢复）';
  let saved={players:{}},savedText=null,storageReadable=true;
  let playerId=null,state=null,orders=[],ordersKnown=false,revision=0,taxBp=200,snapshotTick=-Infinity;
  let quotes=new Map(),requests=new Map(),cooldowns=new Map(),lastQuery=-Infinity,lastSync=-Infinity;
  let procurement=null,tops=new Map(),bookRequests=new Map(),equipmentScan=null,foodScan=null;
  let watched=[],potionWatched=[],watchCursor=0,priorityItem=null;
  let salesEnabled=autoSell===true;
  let capacitySalesEnabled=capacitySales===true;
  // Town buyback (城镇回购, /api/buyback): once a day the town buys
  // over-supplied common goods listed at up to 1.5x the merchant price.
  let buyback=null;
  // Public price feed (/api/market/prices.json, regenerated every 5 minutes):
  // lowest ask and highest bid for every listed item, rarity and enhancement.
  // Planning valuations only; every actual order re-checks the live book.
  let feed=null;
  const feedTtl=900000;
  // Several days of feed prices and observed trades (market-history.js). Only
  // the page records and saves it (`historyStorage`, its own key, never the
  // planning ledger); the Worker reads the copy handed over with the runtime.
  const history=createMarketHistory({now});
  let historySavedAt=-Infinity;
  if(historyStorage)try {history.load(historyStorage.getItem(MARKET_HISTORY_KEY));}catch{}
  function saveHistory(force=false) {
    if(!historyStorage||!force&&now()-historySavedAt<300000)return;
    historySavedAt=now();
    try {historyStorage.setItem(MARKET_HISTORY_KEY,history.text());}catch{}
  }
  // A price more than 20% above both the week's and the last day's average is
  // a spike: valuations of future output use that ceiling instead (a real bid
  // is still sold into at its price). Without history the price stands.
  const spikeMargin=1.2;
  function steady(id,price,side) {
    const typical=Math.max(history.averagePrice(id,{side})??0,history.averagePrice(id,{side,hours:24})??0);
    return typical>0&&price>typical*spikeMargin?Math.floor(typical*spikeMargin):price;
  }
  let need=null,recentOwned=[],reviewOrderId=null,status=salesEnabled?
    '按市场价挂单；被压价才跟一档，不追低价':'平时出售已关闭，物品留给玩家处理';
  const persist=()=>{
    if(!storageReadable)return false;
    try {const text=JSON.stringify(saved);storage?.setItem(key,text);savedText=text;return true;} catch {return false;}
  };
  const quantity=stockQty;
  const valid=n=>Number.isSafeInteger(n)&&n>0;
  const tradable=id=>valid(id)&&id===planner.base(id)&&!!data.items[id]&&tradableBase(data,id);
    const wait=reason=>waiting('市场比价',reason,{marketWaiting:true});
  const defer=reason=>{status=reason;return {...action(null,'市场出售待处理',reason),marketDeferred:true};};
  const natural=p=>!p.route||p.route.phase==='toBank';
  const matching=(order,intent)=>order.itemId===intent.itemId&&
    order.side===(intent.t==='marketBuy'?'buy':'sell')&&order.price===intent.price&&
    order.qtyTotal===intent.qty;
  const ownMatch=(order,owned)=>order.id===owned.id&&order.itemId===owned.itemId&&
    order.side===owned.side&&order.price===owned.price&&order.qtyTotal===owned.qtyTotal;
  function playerState(id) {
    const record=saved.players[id]??={owned:{},attempt:null,income:0,spent:0,fillKeys:[]};
    record.sales??={};record.potionPurchases??=[];record.purchases??=[];
    return record;
  }
  function refresh() {
    if(!storage)return;
    try {
      const text=storage.getItem(key)??null;
      if(text!==savedText) {
        const value=JSON.parse(text??'null');
        if(value!==null&&!value?.players)throw new Error('Invalid market ledger');
        saved=value??{players:{}};savedText=text;
        if(playerId!==null)state=playerState(playerId);
      }
      storageReadable=true;
    } catch {storageReadable=false;}
  }
  function select(p) {
    // A passive tab also receives snapshots. Adopt the shared ledger before
    // writing so it cannot erase another tab's orders or spending commitment.
    refresh();
    if(playerId===p.id)return;
    playerId=p.id;state=playerState(playerId);
    orders=[];ordersKnown=false;revision=0;quotes=new Map();requests=new Map();cooldowns=new Map();
    tops=new Map();bookRequests=new Map();equipmentScan=null;foodScan=null;
    watched=[];potionWatched=[];watchCursor=0;priorityItem=null;
    lastQuery=-Infinity;lastSync=-Infinity;need=null;recentOwned=[];reviewOrderId=null;snapshotTick=-Infinity;taxBp=200;
    if(state.attempt){state.attempt.revision=-1;state.attempt.reviewSale=false;}
  }
  function receive(frame) {
    if(!Array.isArray(frame?.m))return;
    refresh();
    const fillOccurrences=new Map();
    for(const message of frame.m) {
      if(message.t==='emailVerified'&&state?.tradeGateUntil){delete state.tradeGateUntil;persist();}
      if((message.t==='welcome'||message.t==='snapshot')&&message.you?.id!=null) {
        const p=message.you;
        if(!Number.isFinite(frame.tick)||!Number.isFinite(p.lastTick)||!Number.isFinite(p.coins)||
          !Number.isFinite(p.x)||!Number.isFinite(p.y)||!p.bank||typeof p.bank!=='object'||!Array.isArray(p.pack))continue;
        select(message.you);
        if(frame.tick<Math.max(snapshotTick,state.snapshotTick??-Infinity))continue;
        snapshotTick=frame.tick;state.snapshotTick=frame.tick;
        // After a disconnect, disappearance plus new stock cannot prove that
        // the stock came from this cancellation rather than later production.
        if(message.t==='welcome'&&state.attempt?.reviewSale){state.attempt.reviewSale=false;persist();}
        let changed=false;
        for(const [id,sale]of Object.entries(state.sales)) {
          if(state.attempt?.intent.t==='marketSell'&&state.attempt.intent.itemId===Number(id))continue;
          const stock=quantity(p,Number(id));
          if(stock===sale.stock)continue;
          sale.qty=Math.min(stock,Math.max(0,sale.qty-Math.max(0,(sale.stock??stock)-stock)));
          sale.stock=stock;
          if(!sale.qty)delete state.sales[id];
          changed=true;
        }
        if(changed)persist();
        if(Number.isFinite(message.marketTaxBp))taxBp=Math.max(0,Math.min(10000,message.marketTaxBp));
        if(Array.isArray(message.orders)) {
          orders=message.orders.filter(o=>valid(o.id)&&valid(o.itemId)&&valid(o.price)&&valid(o.qtyTotal)&&
            valid(o.qtyRemaining)&&['buy','sell'].includes(o.side));
          ordersKnown=true;revision++;
          for(const [id,owned]of Object.entries(state.owned)) {
            if(!orders.some(o=>ownMatch(o,owned))) {
              recentOwned.push({...owned,removedAt:now()});delete state.owned[id];
            }
          }
          persist();
        }
      } else if(message.t==='marketBooks'&&Array.isArray(message.tops)&&!(frame.tick<snapshotTick)) {
        for(const top of message.tops)if(bookRequests.has(top.itemId)&&
          (top.ask===null||valid(top.ask)&&top.ask<=1e9)&&Number.isSafeInteger(top.askQty)&&top.askQty>=0) {
          tops.set(top.itemId,{...top,at:now()});bookRequests.delete(top.itemId);
        }
      } else if(message.t==='marketDepth'&&requests.has(message.itemId)&&!(frame.tick<snapshotTick)) {
        const rows=list=>(Array.isArray(list)?list:[]).filter(r=>valid(r.price)&&r.price<=1e9&&valid(r.qty));
        quotes.set(message.itemId,{at:now(),bids:rows(message.bids),asks:rows(message.asks),
          trades:rows(message.trades).filter(r=>Number.isFinite(r.tick)),
          tradesKnown:['bids','asks','trades'].every(key=>Array.isArray(message[key])&&rows(message[key]).length===message[key].length)&&
            message.trades.every(r=>Number.isFinite(r.tick)&&r.tick>=0&&r.tick<=frame.tick)});
        const ask=[...rows(message.asks)].sort((a,b)=>a.price-b.price)[0];
        tops.set(message.itemId,{itemId:message.itemId,ask:ask?.price??null,askQty:ask?.qty??0,at:now()});
        requests.delete(message.itemId);
        const book=quotes.get(message.itemId);
        if(book.tradesKnown&&history.recordTrades(message.itemId,book.trades,frame.tick,data.tickMs))saveHistory();
      } else if(message.t==='marketFilled'&&state&&valid(message.qty)&&Number.isFinite(message.coins)) {
        const signature=JSON.stringify(message),occurrence=fillOccurrences.get(signature)??0;
        fillOccurrences.set(signature,occurrence+1);
        const intent=state.attempt?.intent;
        const pending=intent&&intent.itemId===message.itemId&&
          (intent.t==='marketBuy'?'buy':intent.t==='marketSell'?'sell':null)===message.side;
        recentOwned=recentOwned.filter(o=>now()-o.removedAt<ttl);
        const owned=[...Object.values(state.owned),...recentOwned]
          .filter(o=>o.itemId===message.itemId&&o.side===message.side);
        const other=orders.some(o=>o.itemId===message.itemId&&o.side===message.side&&
          !state.owned[o.id]&&!pending);
        if((pending||owned.length===1)&&!other) {
          // The reviewed envelope has only tick, optional command ack a, and m;
          // there is no fill id. Preserve equal legs within one frame, while an
          // exact replay is ignored. Identical separate frames with the same
          // tick/ack remain ambiguous, so we conservatively do not count twice.
          const fillKey=JSON.stringify([frame.tick,frame.a??null,message,occurrence]);
          if(state.fillKeys.includes(fillKey))continue;
          state.fillKeys.push(fillKey);state.fillKeys=state.fillKeys.slice(-50);
          if(message.side==='sell')state.income+=Math.max(0,message.coins-(message.tax??0));
          else state.spent+=Math.max(0,message.coins);
          if(pending)state.attempt.filled=Math.min(intent.qty,(state.attempt.filled??0)+message.qty);
          persist();
        }
      }
    }
  }
  function query(p) {
    select(p);
    if(closed(p))return null;
    if((!ordersKnown||state.attempt)&&now()-lastSync>=5000) {
      lastSync=now();return {t:'resync'};
    }
    if(state.attempt||now()-lastQuery<1500)return null;
    for(const [itemId,request]of requests)if((request.background||request.potionBackground||request.review)&&
      request.sentAt!=null&&now()-request.sentAt>=waitMs) {
      requests.delete(itemId);cooldowns.set(itemId,now()+coolMs);
    }
    for(const [itemId,request]of requests)if(request.sentAt==null) {
      request.sentAt=now();lastQuery=now();return {t:'marketDepth',itemId};
    }
    for(const [id,request]of bookRequests)if(request.sentAt!=null&&now()-request.sentAt>=waitMs) {
      bookRequests.delete(id);cooldowns.set(id,now()+coolMs);
    }
    const itemIds=[...bookRequests].filter(([,r])=>r.sentAt==null).slice(0,64).map(([id])=>id);
    if(itemIds.length&&slots(p,'buy')) {
      for(const id of itemIds)bookRequests.get(id).sentAt=now();
      lastQuery=now();return {t:'marketBooks',itemIds};
    }
    if([...requests.values()].some(request=>request.sentAt!=null&&now()-request.sentAt<waitMs))return null;
    if(!slots(p,'buy'))return null;
    const priorityQuote=quotes.get(priorityItem);
    if(priorityItem!==null&&!hasOrder(priorityItem)&&(cooldowns.get(priorityItem)??0)<=now()&&
      (!priorityQuote||now()-priorityQuote.at>=8000)) {
      requests.set(priorityItem,{at:now(),sentAt:now(),background:true});lastQuery=now();
      return {t:'marketDepth',itemId:priorityItem};
    }
    const background=[...watched.map(itemId=>({itemId,potion:false})),...potionWatched.map(itemId=>({itemId,potion:true}))];
    for(let n=0;n<background.length;n++) {
      const {itemId,potion}=background[watchCursor++%background.length],current=quotes.get(itemId);
      if((cooldowns.get(itemId)??0)>now()||hasOrder(itemId)||current&&now()-current.at<(potion?8000:ttl))continue;
      requests.set(itemId,{at:now(),sentAt:now(),...(potion?{potionBackground:true}:{background:true})});lastQuery=now();
      return {t:'marketDepth',itemId};
    }
    return null;
  }
  function watch(p,itemIds,priorityItemId=null) {
    select(p);
    // Quotes are read-only: always fetch them so planning can value sales.
    watched=closed(p)?[]:[...new Set(itemIds.filter(id=>tradable(id)&&!saleProtectionReason(data,id)))].slice(0,32);
    watchCursor%=watched.length||1;
    priorityItem=watched.includes(priorityItemId)?priorityItemId:null;
    for(const [id,request]of requests)if(request.background&&!watched.includes(id))requests.delete(id);
  }
  function watchPotions(p,itemIds) {
    select(p);
    if(procurement?.enabled)scan(p,itemIds.flatMap(variants));
    potionWatched=closed(p)?[]:[...new Set(itemIds.filter(id=>POTIONS.some(potion=>potion.itemId===id)&&tradable(id)))].slice(0,8);
    for(const [id,request]of requests)if(request.potionBackground&&!potionWatched.includes(id))requests.delete(id);
  }
  // Sale value of new output: the best of filling current bids, listing at the
  // ask (listing mode, with proven demand) and the merchant (系统回收), which
  // always buys at 40% of base value. The merchant is also the lower bound
  // while market quotes are missing, stale or cooling down.
  function opportunity(p,itemId,qty) {
    select(p);
    if(closed(p))return null;
    if(!tradable(itemId)||saleProtectionReason(data,itemId)||!valid(qty))return null;
    const floor=merchantPrice(data,itemId);
    let merchant={net:floor*qty,qty,merchant:true};
    // Town buyback: valued at what it actually paid on average, for at most
    // half of its last daily volume (other sellers compete for it).
    const bb=buybackFor(p,itemId);
    if(bb&&qty+quantity(p,itemId)<=bb.qty/2) {
      const value=netOf(Math.round(bb.merchant*bb.ratio),qty);
      if(value>merchant.net)merchant={net:value,qty,buyback:true};
    }
    if(state.attempt||!slots(p)||hasOrder(itemId)||(cooldowns.get(itemId)??0)>now())return merchant;
    const book=quotes.get(itemId);
    if(!book||now()-book.at>=ttl) {
      // Price feed: the top bid, only for what its buyers can take after stock.
      const row=feedRow(itemId),m=marketPrice(itemId);
      // Listed at the market price, as the sale rule does, when a day's turnover takes it.
      if(m>0&&dailyTurnover(itemId)>=qty+quantity(p,itemId)&&netOf(m,qty)>Math.max(floor*qty,merchant.net))return {net:netOf(m,qty),qty,listed:true};
      if(row?.bid&&row.bidQty-quantity(p,itemId)>=qty) {
        const value=netOf(steady(itemId,row.bid,'bid'),qty);
        if(value>floor*qty&&value>merchant.net)return {net:value,qty,feed:true};
      }
      return merchant;
    }
    // Market value counts only new output that current buyers could absorb
    // after existing stock. Asking prices and escrow never count as earned income.
    let stock=quantity(p,itemId),remaining=qty,net=0,bidValue=null;
    for(const bid of bidsHighFirst(book)) {
      const old=Math.min(stock,bid.qty),take=Math.min(remaining,bid.qty-old);
      const proceeds=netOf(steady(itemId,bid.price,'bid'),take);
      if(take>0&&proceeds<=floor*take)continue;
      stock-=old;remaining-=take;net+=proceeds;
      if(!remaining){bidValue={net,qty};break;}
    }
    // The sale rule lists (the day's price clearly above the bid): value at
    // the listing price when recent buyers at that price could take this
    // output after existing stock and the queue ahead.
    if(book.tradesKnown===true) {
      const best=bidsHighFirst(book)[0]?.price,listing=listable(itemId,best)?listingQuote(p,book,itemId,floor):null;
      const room=listing?listing.demand.volume-listing.demand.ahead-quantity(p,itemId):0;
      const listed=listing&&netOf(steady(itemId,listing.price,'ask'),qty);
      if(listing&&room>=qty&&listed>floor*qty&&listed>(bidValue?.net??0))return {net:listed,qty,listed:true};
    }
    return bidValue&&bidValue.net>merchant.net?bidValue:merchant;
  }
  // The lowest ask for one unit: a fresh live top of book, else the price feed.
  function askPrice(p,id) {
    select(p);
    if(closed(p))return null;
    const top=topOfBook(id);
    return top?.ask>0&&top.askQty>0?top.ask:null;
  }
  // What one unit is worth: what the sale rule itself gets for it, after tax.
  // That is the market price (marketPrice: the price it lists at), or a
  // fresh buy order when one pays more, and never less than the merchant or
  // the town buyback. Every valuation reads it (planner.saleValue): held stock
  // used, burnt as house fuel or sold, and new output. It used to count only
  // buy orders big enough to take the quantity on top of the stock already
  // held, so a bank of logs selling for 100+ was worth the merchant's few coins.
  function unitValue(p,id,qty=1) {
    select(p);
    const merchant=merchantPrice(data,id);
    if(closed(p))return merchant;
    const n=Math.max(1,qty),net=price=>price>0?netOf(price,n)/n:0;
    const live=quotes.get(id);
    const bid=live&&now()-live.at<ttl?bidsHighFirst(live)[0]?.price:feedRow(id)?.bid;
    const bb=id===planner.base(id)?buybackFor(p,id):null;
    return Math.max(merchant,net(marketPrice(id)),net(bid?steady(id,bid,'bid'):0),bb?net(Math.round(bb.merchant*bb.ratio)):0);
  }
  // Freshness counts from our fetch; a feed whose own timestamp is far from it
  // (an old cached copy, or a badly wrong clock) is not used.
  function setPriceFeed(value,at=now()) {
    const generated=Date.parse(value?.generatedAt);
    if(!value?.items||typeof value.items!=='object'||!Number.isFinite(generated)||Math.abs(at-generated)>3600000)return false;
    const price=n=>Number.isSafeInteger(n)&&n>0&&n<=1e9?n:null,amount=n=>Number.isSafeInteger(n)&&n>0?n:0;
    const items={};
    for(const [key,row]of Object.entries(value.items)) {
      const id=Number(key);
      if(!valid(id)||!row||typeof row!=='object')continue;
      items[id]={ask:price(row.lowestSell),askQty:amount(row.sellQty),bid:price(row.highestBuy),bidQty:amount(row.buyQty),avg:price(Math.round(row.avg7d??0)),vol:amount(row.vol7d)};
    }
    feed={at,items};
    // History keeps tradable ids, ordinary items before their quality and
    // enhancement variants, sampled at the feed's own time.
    const kept=Object.entries(items).map(([key,row])=>[Number(key),row]).filter(([id])=>
      !!data.items[planner.base(id)]&&tradableBase(data,planner.base(id))).sort(([a],[b])=>
      (a!==planner.base(a))-(b!==planner.base(b))||a-b);
    if(history.recordFeed(kept,generated))saveHistory(true);
    return true;
  }
  const feedFresh=()=>!!feed&&now()-feed.at<feedTtl;
  const feedRow=id=>feedFresh()?feed.items[id]??null:null;
  // Top of the book for one id: a fresh live top (under a minute old), else
  // the price feed. Every ask lookup and "is it priced" check reads this.
  const topOfBook=id=>{const live=tops.get(id);return live&&now()-live.at<60000?live:feedRow(id);};
  const bestAsk=book=>book.asks.reduce((best,row)=>!best||row.price<best.price?row:best,null);
  const lowestAsk=book=>bestAsk(book)?.price;
  const bidsHighFirst=book=>[...book.bids].sort((a,b)=>b.price-a.price);
  function quote(id) {
    if((cooldowns.get(id)??0)>now())return {fallback:true};
    const current=quotes.get(id);
    if(current&&now()-current.at<ttl)return current;
    if(!requests.has(id))requests.set(id,{at:now(),sentAt:null});
    else {requests.get(id).background=false;requests.get(id).potionBackground=false;}
    // Count queue time too. A busy query queue must not keep the character idle.
    if(now()-requests.get(id).at>=waitMs) {
      const request=requests.get(id);
      if(request.sentAt!=null&&now()-request.sentAt>=waitMs){requests.delete(id);cooldowns.set(id,now()+coolMs);}
      return {fallback:true};
    }
    // Refresh stale quotes in the background, never reopen a blocking wait
    // each time a background tab wakes after the quote's fifteen-second TTL.
    if(current)return {fallback:true};
    return {waiting:true};
  }
  function atBank(p,intent,label,critical=false) {
    if(!critical&&!natural(p))return action(null,'市场交易待返仓','先完成当前任务，再处理盈余订单');
    if(!planner.nearBank(p)) {
      const bank=[...data.banks].sort((a,b)=>distance(p,a)-distance(p,b))[0];
      return action({t:'walk',...bank.approach},'市场交易 · 前往仓库',label);
    }
    if(p.route||p.path?.length)return action({t:'clearRoute'},'交易前停止路线并确认库存',label);
    return action(intent,label);
  }
  const tier=id=>rarityOf(data,id);
  const labelOf=id=>itemLabel(data,id);
  const variants=id=>usableQualities(data,id);
  const purchasable=id=>valid(id)&&buyableItem(data,id)&&plusOf(data,id)<=ENHANCEMENT_MAX&&
    tradable(planner.base(id))&&(id<data.plusScale||!!planner.equipmentStats(id));
  function configureProcurement(value={}) {
    // Old reserve/hourly preferences migrate to value-based purchasing.
    procurement={enabled:value?.enabled!==false};
    if(!procurement.enabled)bookRequests.clear();
    return {...procurement};
  }
  function purchaseSpent() {
    if(!state)return 0;
    state.purchases=state.purchases.filter(e=>Number.isFinite(e.at)&&now()-e.at<3600000&&e.cost>0);
    return state.purchases.reduce((sum,e)=>sum+e.cost,0)+potionBudgetSpent();
  }
  // What may be spent: the coins above the one reserve (inventory.coinReserve).
  function purchaseAllowance(p,goal=null) {
    return !procurement?.enabled||closed(p)?0:Math.max(0,p.coins-coinReserve(planner,p,goal));
  }
  function scan(p,ids) {
    select(p);
    if(!purchaseAllowance(p)||state.attempt||!slots(p,'buy'))return [];
    const found=[];
    for(const id of new Set(ids.filter(purchasable))) {
      if(hasOrder(id)||(cooldowns.get(id)??0)>now())continue;
      // The price feed answers without a query; buy() re-checks the live ask.
      const top=topOfBook(id);
      if(top){if(valid(top.ask)&&top.askQty>0)found.push(top.at!=null?top:{itemId:id,ask:top.ask,askQty:top.askQty,feed:true});continue;}
      // The fresh feed lists every item with an order: one it leaves out has
      // nothing for sale, so its book is not asked for.
      if(feed&&now()-feed.at<feedTtl)continue;
      if(!bookRequests.has(id))bookRequests.set(id,{sentAt:null});
    }
    return found;
  }
  // The gold one unit costs now, when `qty` can be bought within the allowance;
  // Infinity when it cannot be bought automatically.
  function marketBuyPrice(p,id,qty=1) {
    select(p);const top=topOfBook(id);
    if(closed(p)||!purchasable(id)||!procurement?.enabled||state.attempt||hasOrder(id)||!slots(p,'buy')||
      (cooldowns.get(id)??0)>now()||!(top?.ask>0)||top.askQty<qty||
      top.ask*qty>purchaseAllowance(p))return Infinity;
    return top.ask;
  }
  function surplusValue(p,id,qty) {
    select(p);
    if(closed(p)||!tradable(id)||!valid(qty))return Infinity;
    const book=quote(id);
    // Unknown/stale markets never make goods "worthless". This query does not
    // pause gathering or authorize a sale; it only bounds the cost of disposal.
    // The highest price anyone shows, after tax, and never below the merchant.
    const worth=price=>Math.max(qty*merchantPrice(data,id),netOf(price,qty));
    if(book.waiting||book.fallback||!book.tradesKnown) {
      const row=feedRow(id);
      return row&&(row.ask||row.bid)?worth(Math.max(row.ask??0,row.bid??0)):Infinity;
    }
    const recent=book.trades.filter(r=>r.tick>=p.lastTick-recycleMs/data.tickMs);
    return worth(Math.max(lowestAsk(book)??0,...book.bids.map(r=>r.price),...recent.map(r=>r.price)));
  }
  function buy(p,id,qty,goal,label,reason,priceCap=Infinity) {
    if(closed(p)||p.enhance||playerQueued(p)||!purchasable(id)||!valid(qty)||state.attempt||!slots(p,'buy')||hasOrder(id))return null;
    const capacity=inventoryBudget(data,planner,p,goal);
    if(capacity.freeSlots<=0&&!(p.bank[id]>0))return null;
    const book=quote(id);
    if(book.waiting)return wait('正在核对候选物品的实时卖盘与采购预算');
    if(book.fallback)return null;
    const ask=bestAsk(book);
    if(!ask||ask.price>priceCap)return null;
    const amount=Math.min(qty,ask.qty,Math.floor(purchaseAllowance(p,goal)/ask.price),1000000);
    if(amount<1)return null;
    const result=atBank(p,{t:'marketBuy',itemId:id,qty:amount,price:ask.price},`${label} · ${labelOf(id)} × ${amount}`,true);
    result.reason=`${reason}；单价 ${ask.price}，本笔 ${amount*ask.price} 金币；核对现有金币及任务必需开销`;
    if(result.intent?.t==='marketBuy')Object.assign(result,{procurement:true,purchaseReserve:goal?.budget?.coins??0});
    status=result.reason;return result;
  }
  function balancedPurchase(p,id,qty,goal,profession) {
    if(closed(p)||!purchasable(id)||!valid(qty)||state.attempt||!purchaseAllowance(p,goal))return null;
    need={itemId:id,qty,at:now()};
    const listed=orders.find(o=>o.itemId===id&&o.side==='sell'&&state.owned[o.id]);
    if(listed){reviewOrderId=null;return atBank(p,{t:'marketCancel',orderId:listed.id},'撤回自有挂单 · 当前计划需要',true);}
    if(!slots(p,'buy')||hasOrder(id)||(cooldowns.get(id)??0)>now())return null;
    const book=quote(id);
    if(book.waiting)return wait('比较买成品、买原料与自给的实际耗时');
    if(book.fallback)return null;
    const ask=bestAsk(book),rate=planner.coinRate?.(p);
    if(!ask||!(rate>0))return null;
    const amount=Math.min(qty,ask.qty,Math.floor(purchaseAllowance(p,goal)/ask.price),1000000);
    if(amount<1)return null;
    // The one make-or-buy verdict (input-cost.js decide), at the live ask: the
    // same rule the recipe ratings assumed, so what they count as bought is bought.
    const verdict=planner.inputCost?.decide(p,id,amount,{style:profession,credit:!goal?.quest,price:ask.price});
    if(!verdict?.buy) {
      status=`${labelOf(id)}：自制或自采更省（含所练技能的经验），不买`;return null;
    }
    const seconds=goldToSeconds(amount*ask.price,rate)+bankTripSeconds(data,p);
    return buy(p,id,amount,goal,'市场补齐当前需求',`买比自制或自采省：采购资金时间与往返约 ${Math.ceil(seconds)} 秒`,ask.price);
  }
  // Buys the piece the investment table picked (`row`, passed by the planner)
  // once its live ask is confirmed at no more than the table's price: the table
  // already weighed every quality, enhancement, making it and enhancing the worn
  // piece by one payback rule. `ids`: the pieces whose quotes are watched (every
  // quality and +0..+20) so the table can price them.
  function equipmentPurchase(p,goal,profession,{ids,row=null}) {
    select(p);if(!ids.length||!purchaseAllowance(p,goal))return null;
    const scanKey=JSON.stringify([profession,p.equipment,planner.levels(p)]);
    if(equipmentScan?.key!==scanKey)equipmentScan={key:scanKey,startedAt:now()};
    const candidates=ids.flatMap(id=>variants(id).flatMap(quality=>Array.from({length:ENHANCEMENT_MAX+1},(_,plus)=>quality+plus*data.plusScale)));
    scan(p,candidates);
    // `row.qty` several at the unit price `row.gold` (a breeding plan's lower mounts).
    if(row&&row.gold<=purchaseAllowance(p,goal)) {
      const result=buy(p,row.id,row.qty??1,goal,'市场升级装备',`投资表首选：${row.label}，约 ${(row.paid/3600).toFixed(1)} 小时金币，`+
        `使用期内省约 ${(row.saved/3600).toFixed(1)} 小时（效率 +${Math.round(row.gain*100)}%）`,row.gold);
      if(result?.intent?.t==='marketBuy')result.equipmentItemId=row.id;
      if(result)return result;
    }
    // Optional investment quotes must never gate productive work. With many
    // qualities/slots, early quotes can expire before the last query finishes;
    // waiting for the whole set would restart the scan forever in a throttled tab.
    if(candidates.some(id=>bookRequests.has(id))) {
      status='后台查询装备报价；先继续当前供料或练级，取得报价后在任务边界复核';
      // One shared four-second window for the entire equipment/level state,
      // including unsent requests. Quote expiry cannot reopen that window.
      if(now()-equipmentScan.startedAt<waitMs)return wait('首次装备比价最多等待 4 秒；已有游戏任务继续运行');
    }
    return null;
  }
  function potionDose(p,id,goal,desired) {
    select(p);
    const reserve=inventoryBudget(data,planner,p,goal).items;
    const owned=variants(id).map(itemId=>({itemId,power:rarityPower(data,itemId),
      qty:Math.min(desired,20,reachableQty(data,p,itemId),Math.max(0,quantity(p,itemId)-(reserve[itemId]??0)))
    })).filter(choice=>choice.qty>0);
    if(!procurement?.enabled)return owned.sort((a,b)=>a.itemId-b.itemId)[0]??null;
    const choices=variants(id).map(itemId=>{
      const power=rarityPower(data,itemId),top=topOfBook(itemId);
      const available=reachableQty(data,p,itemId);
      const qty=Math.min(desired,20,available,Math.max(0,quantity(p,itemId)-(reserve[itemId]??0)));
      const price=top?.ask>0?top.ask:data.items[id].value*power;
      return {itemId,qty,power,value:pricePerEffect(data,price,itemId)};
    }).filter(c=>c.qty>0&&Number.isFinite(c.value)).sort((a,b)=>a.value-b.value||a.itemId-b.itemId);
    return choices[0]??null;
  }
  // Why no potion was bought, from the same offers and limits the purchase
  // (balancedPotion) uses: the price feed counts, and so does the value cap.
  function potionStatus(p,itemId,goal=null,desiredQty=1,worth=null) {
    select(p);
    const name=itemName(data,planner.base(itemId));
    if(!procurement?.enabled)return {key:'procurement-off',message:`药水未喝：${name}库存不足，按收益采购已关闭`};
    if(closed(p))return {key:'procurement-off',message:`药水未喝：${name}库存不足；${closedReason(p)}`};
    if(!planner.nearBank(p)||p.route||p.path?.length||playerQueued(p))
      return {key:'route',message:`药水未喝：${name}库存不足，当前路线或位置不在安全补货边界`};
    const allowance=purchaseAllowance(p,goal);
    if(!(allowance>0))return {key:'budget',message:`药水未喝：${name}库存不足，采购预算不足`};
    if(state.attempt||!slots(p,'buy'))return {key:'quote',message:`药水未喝：${name}库存不足，上一笔交易待确认或挂单栏已满`};
    const offers=scan(p,variants(itemId));
    if(!offers.length)return {key:'quote',message:variants(itemId).some(id=>bookRequests.has(id))?
      `药水未喝：${name}库存不足，正在等待有效卖盘报价`:`药水未喝：${name}暂无卖盘`};
    const cheapest=offers.reduce((a,b)=>pricePerEffect(data,a.ask,a.itemId)<=pricePerEffect(data,b.ask,b.itemId)?a:b);
    const cap=potionCap(itemId,cheapest.itemId,worth);
    if(offers.every(o=>o.ask>potionCap(itemId,o.itemId,worth)))
      return {key:'budget',message:`药水未喝：${name}卖盘最低 ${cheapest.ask} 高于药效价值上限约 ${Math.floor(cap)}（${Number.isFinite(worth)&&worth>0?'按省下的时间折算':'无法估算省时，按基础价值 3 倍'}）`};
    if(offers.every(o=>o.ask>allowance))return {key:'budget',message:`药水未喝：${name}卖盘最低 ${cheapest.ask} 超出采购预算 ${Math.floor(allowance)}`};
    return {key:'quote',message:`药水未喝：${name}暂无可用报价`};
  }
  // The most one bottle of this quality may cost. With a known worth (the
  // coins its hour of effect saves at the gold rate) the gold-as-time payback
  // rule applies; with no known worth nothing is bought.
  const potionCap=(id,itemId,worth=null)=>(Number.isFinite(worth)&&worth>0?maxPrice(worth):0)*
    rarityPower(data,itemId);
  function balancedPotion(p,id,goal,desired,uncovered=[],worth=null) {
    if(!POTIONS.some(potion=>potion.itemId===id)||!valid(desired)||!planner.nearBank(p)||p.route||p.path?.length||
      p.enhance||playerQueued(p))return null;
    const reserve=inventoryBudget(data,planner,p,goal).items;
    const stocked=variants(id).reduce((n,itemId)=>n+Math.max(0,quantity(p,itemId)-(reserve[itemId]??0)),0);
    const missing=Math.max(0,Math.min(20,desired)-stocked);if(!missing)return null;
    const choices=scan(p,variants(id)).filter(top=>top.ask<=purchaseAllowance(p,goal)&&top.ask<=potionCap(id,top.itemId,worth))
      .sort((a,b)=>pricePerEffect(data,a.ask,a.itemId)-pricePerEffect(data,b.ask,b.itemId)||a.ask-b.ask);
    if(!choices.length)return null;
    const top=choices[0];
    // Cover other applicable expired effects before stacking this one to 20h.
    // Only fresh, affordable offers count; unknown stock never stalls work.
    let coverage=0;
    for(const other of new Set(uncovered))if(other!==id&&!variants(other).some(itemId=>quantity(p,itemId)>(reserve[itemId]??0))) {
      const asks=scan(p,variants(other)).filter(row=>row.ask<=purchaseAllowance(p,goal)&&
        row.ask<=potionCap(other,row.itemId));
      if(asks.length)coverage+=Math.min(...asks.map(row=>row.ask));
    }
    if(coverage+top.ask>purchaseAllowance(p,goal)&&
      (p.brews?.[POTIONS.find(potion=>potion.itemId===id).kind]??0)>p.lastTick)return null;
    const coveredGoal=coverage+top.ask<=purchaseAllowance(p,goal)?
      {...goal,budget:{...goal?.budget,coins:(goal?.budget?.coins??0)+coverage}}:goal;
    const result=buy(p,top.itemId,coverage&&coveredGoal===goal?Math.min(1,missing):missing,coveredGoal,'按品质性价比补药',
      `各品质每瓶同为 1 小时，当前药效倍率 ×${rarityPower(data,top.itemId)}`+
      (worth>0?`；药效每小时约省下价值 ${Math.round(worth*rarityPower(data,top.itemId))} 金币的时间`:''),top.ask);
    return result?.intent?.t==='marketBuy'?{...result,consumablePurchase:true}:null;
  }
  function foodPurchase(p,goal,supplies) {
    select(p);if(!purchaseAllowance(p,goal)||!supplies.needFood)return null;
    const scanKey=JSON.stringify([goal?.skill,supplies.foodItemId,p.foodMaxTier]);
    if(foodScan?.key!==scanKey)foodScan={key:scanKey,startedAt:now()};
    const ids=data.jobs.filter(j=>j.skill==='cooking').flatMap(j=>variants(j.output.itemId))
      .filter(id=>tier(id)<=(p.foodMaxTier??1));
    const choices=scan(p,ids).map(top=>({...top,heal:foodHealing(data,planner,p,top.itemId,.5).heal}))
      .filter(c=>c.heal>=supplies.heal&&c.ask*supplies.needFood<=purchaseAllowance(p,goal))
      .sort((a,b)=>a.ask/a.heal-b.ask/b.heal||a.ask-b.ask);
    const best=choices[0];
    // A quote refresh cannot repeatedly defer preparing a usable food supply.
    if(!best)return now()-foodScan.startedAt<waitMs&&ids.some(id=>bookRequests.has(id))?
      wait('首次熟食比价最多等待 4 秒；随后继续自给备粮'):null;
    // The one make-or-buy verdict, at the live ask (cooking it, with the
    // cooking XP credited, may be the cheaper way).
    if(!planner.inputCost?.decide(p,best.itemId,supplies.needFood,{style:goal?.style??planner.styleHint??'magic',
      credit:!goal?.quest,price:best.ask})?.buy)return null;
    const result=buy(p,best.itemId,supplies.needFood,goal,'市场补充熟食',
      `每份有效治疗 ${best.heal}；按实际缺口采购，遵守游戏自动进食品质上限`,best.ask);
    if(result?.intent?.t==='marketBuy')result.foodItemId=best.itemId;
    return result;
  }
  function buffFood(p,goal,{duration,enemyDps,healing,damageReduction,foodValue,fedShare=0}) {
    select(p);if(!procurement?.enabled||closed(p))return null;
    const ids=Object.values(data.items).filter(i=>i.heals).flatMap(i=>variants(i.id));
    const reserve=inventoryBudget(data,planner,p,goal,true).items,rate=planner.coinRate(p);
    const choices=scan(p,ids).map(top=>{
      const effects=foodEffects(data,top.itemId),tick=data.tickMs/1000;
      const fed=(p.brews?.fed??0)>p.lastTick?0:Math.min(duration,effects.fedTicks*tick);
      const rooted=(p.brews?.rooted??0)>p.lastTick?0:Math.min(duration,effects.rootedTicks*tick);
      // Fed: the fight-time cut its +25% max hit gives (fedShare); rooted: the food it saves.
      const benefit=secondsToGold(fed*fedShare,rate)+rooted*enemyDps/Math.max(1,healing)*damageReduction*foodValue;
      // What eating it costs: a held one what using stock gives up, a bought one its ask.
      const owned=quantity(p,top.itemId)>(reserve[top.itemId]??0),cost=owned?planner.stockValue?.(p,top.itemId,1)??planner.saleValue(p,top.itemId,1):top.ask;
      return {...top,fed,rooted,benefit,cost,owned};
    }).filter(c=>pays(goldToSeconds(c.benefit,rate),goldToSeconds(c.cost,rate)))
      .sort((a,b)=>(b.benefit-b.cost)-(a.benefit-a.cost)||a.ask-b.ask);
    for(const c of choices) {
      const available=reachableQty(data,p,c.itemId);
      const reason=`按本次战斗窗口比价，饱食覆盖约 ${Math.ceil(c.fed)} 秒、减伤约 ${Math.ceil(c.rooted)} 秒；参考价 ${c.ask}`;
      if(available>0&&quantity(p,c.itemId)>(reserve[c.itemId]??0))return action(
        {t:'eat',itemId:c.itemId,qty:1,...(!p.pack.some(i=>i.itemId===c.itemId&&i.qty>0)?{shelf:true}:{})},
        `使用增益食物 · ${labelOf(c.itemId)}`,reason);
      if(!planner.nearBank(p)||p.route||p.path?.length||playerQueued(p))continue;
      // Buy only a dose that can be consumed without using reserved stock.
      if((reserve[c.itemId]??0)>quantity(p,c.itemId))continue;
      const result=buy(p,c.itemId,1,goal,'补充战斗增益食物',reason,c.ask);
      if(result?.intent?.t==='marketBuy')return {...result,consumablePurchase:true};
    }
    return null;
  }
  // Order slots: the game's own limit. Sell listings (which sit for hours) may
  // take every slot but one, kept for a purchase. A fixed cap of three of the
  // helper's own listings let three slow ones block every sale while seven
  // slots stood empty.
  function slots(p,side='sell') {
    const limit=p.marketOrderSlots??10;
    return ordersKnown&&orders.length<(side==='buy'?limit:limit-1);
  }
  const hasOrder=id=>orders.some(o=>o.itemId===id);
  const ownedOf=order=>Object.values(state.owned).find(owned=>ownMatch(order,owned))??null;
  const heldForBuyback=(p,owned)=>!!owned?.buyback&&p.lastTick<owned.buyback.holdUntilTick;
  // What a sell listing brings in a day: its price on what the market takes of
  // it in a day, never more than it holds. A waiting sale is valued the same way
  // at the market price and its list size.
  const dayValue=(id,price,qty)=>{const d=dailyTurnover(id);return d>0&&price>0?price*Math.min(qty,d):0;};
  // One rule for a full order book: a sell slot goes to what sells for most in
  // a day. A waiting sale worth twice the weakest of the helper's own listings
  // takes its slot (that stock goes back to the bank and waits its turn); the
  // player's own orders and buyback listings held for the run are never touched.
  // Nine slow gear listings once kept 52M of quality tin off the market.
  const SLOT_MARGIN=2;
  function slotFor(p,id,qty) {
    const value=dayValue(id,marketPrice(id),listSize(id,qty));
    if(!(value>0))return null;
    // A listing gets its review time before it can give up its slot: sales are
    // offered one at a time, so a fresh listing evicted by the next waiting
    // sale started a chain of cancels (2026-11-08: five in twenty seconds).
    const weakest=orders.filter(o=>o.side==='sell'&&o.itemId!==id).map(o=>({o,owned:ownedOf(o)}))
      .filter(({owned})=>owned&&!heldForBuyback(p,owned)&&now()-owned.at>=reviewMs)
      .map(({o})=>({o,value:dayValue(o.itemId,o.price,o.qtyRemaining)})).sort((a,b)=>a.value-b.value||a.o.id-b.o.id)[0];
    if(!weakest||value<SLOT_MARGIN*weakest.value)return null;
    reviewOrderId=null;
    status=`挂单槽已满：${labelOf(id)} 每天约可卖 ${Math.round(value)}，撤回每天约 ${Math.round(weakest.value)} 的 ${labelOf(weakest.o.itemId)} 让出挂单槽`;
    return atBank(p,{t:'marketCancel',orderId:weakest.o.id},`挂单槽让位 · 撤回 ${labelOf(weakest.o.itemId)}，改挂 ${labelOf(id)}`);
  }
  // One order per item: a listing of the helper's own that has sold down to
  // under two thirds of what one listing of it would now hold (with the new
  // surplus) is taken back after its review and listed again as one
  // order. A second order of the same item is merged the same way.
  function merged(p,id,qty) {
    const listed=orders.filter(o=>o.itemId===id);
    const own=listed.map(o=>({o,owned:ownedOf(o)})).filter(({o,owned})=>o.side==='sell'&&owned&&!heldForBuyback(p,owned));
    if(!own.length||own.length<listed.length)return null;
    const held=own.reduce((n,{o})=>n+o.qtyRemaining,0);
    const pick=own.length>1?own.sort((a,b)=>a.o.qtyRemaining-b.o.qtyRemaining||b.o.id-a.o.id)[0]:
      now()-own[0].owned.at>=reviewMs&&listSize(id,held+qty)*2>=held*3?own[0]:null;
    if(!pick)return null;
    reviewOrderId=null;
    status=`${labelOf(id)} 合并为一张挂单：撤回 ${pick.o.qtyRemaining} 件，连同仓库盈余重新挂出`;
    return atBank(p,{t:'marketCancel',orderId:pick.o.id},`合并挂单 · 撤回 ${labelOf(id)} × ${pick.o.qtyRemaining}，与盈余一起重挂`);
  }
  function saleDemand(p,book,price,floor) {
    const trades=book.trades.filter(row=>row.tick<=p.lastTick&&(p.lastTick-row.tick)*data.tickMs<=recycleMs&&
      row.price>=price&&netOf(row.price,row.qty)>floor*row.qty);
    const volume=trades.reduce((n,row)=>n+row.qty,0);
    const ahead=book.asks.filter(row=>row.price<=price).reduce((n,row)=>n+row.qty,0);
    return {volume,ahead,illiquid:book.tradesKnown===true&&volume<=ahead};
  }
  // One market price per item: the whole market's 7-day average (price feed),
  // else the trades this helper watched over the week. Listings, bids and every
  // valuation (unitValue) read it.
  // A week's average counts only on real turnover: at least about one trade a
  // day (a handful of trades can say anything: a +2 Bronze pickaxe "averaged"
  // 232M on three).
  // Nor above what the game's shop asks for it: a common Potato seed (shop 8)
  // "averaged" 115,503 over 3,031 trades while its best bid was 1, which made
  // chopping Trees look worth 3.2M/h instead of about 1.8M/h.
  // Nor set by a freak trade: an average more than twice off the median of the
  // week's trades the book showed (history.tradeMedian) is replaced by that
  // median. One Bogskin chaps sold for 120,000,000 among trades of 600-3,600
  // made its 7-day average 1,072,910, and a listing went up at 1,060,000.
  // Nor more than twice the lowest ask: anyone can buy at that ask, so a price
  // far above it is a freak trade's, and the ask stands in. A Voidmelon seed
  // (a yew bonus drop, never sold, so its book never read) "averaged"
  // 1,061,038 while asked at 1,800, which made yew look worth 3.2M/h
  // instead of about 0.7M/h.
  const MIN_WEEK_VOLUME=7,OUTLIER=2;
  const marketPrice=id=>{const row=feedRow(id);
    let price=(row?.vol>=MIN_WEEK_VOLUME?row.avg:null)??history.tradePrice(id)??null;
    const median=history.tradeMedian(id);
    if(price>0&&median>0&&(price>median*OUTLIER||price*OUTLIER<median))price=median;
    if(price>0&&row?.ask>0&&price>row.ask*OUTLIER)price=row.ask;
    return price>0?Math.min(price,shopPrice(data,id)??Infinity):price;};
  // Units the market takes a day: the feed's 7-day volume, else what was watched.
  const dailyTurnover=id=>{const v=feedRow(id)?.vol;return v>0?v/7:history.dailyVolume(id);};
  // Sell as a player does: one step under the cheapest competitor, never under
  // 90% of the market price (a lone cheap ask is ignored, not chased) nor over
  // 115% of it (asks far above what trades would sit unsold, and a listing is
  // never cut on a timer), and at the market price when nobody else sells. A bid is filled at once only
  // within 3% of the market price. One listing offers a tenth of a day's
  // turnover at most: a thin market (gear, rare goods) is not flooded and its
  // price not pushed down; the rest waits in the bank.
  const FAIR=.9,CEILING=1.15,BID_FAIR=.97,LIST_SHARE=.1;
  const fairBid=(id,price,listing=null)=>{const m=marketPrice(id);return m>0?price>=m*BID_FAIR:!listing||price>=listing.price*BID_FAIR;};
  const listable=(id,bidPrice)=>marketPrice(id)>0&&(bidPrice==null||!fairBid(id,bidPrice));
  const listSize=(id,qty)=>{const d=dailyTurnover(id);return Math.min(qty,d>0?Math.max(1,Math.floor(d*LIST_SHARE)):1);};
  // The 90% floor ignores a thin cheap ask. Once more units are offered under
  // it than the market takes in a day, those asks are the market: they sell
  // first, a listing above them waits for weeks (the week's average lags a
  // falling price), so the floor is dropped and the lowest ask followed. Depth
  // from the live book, else the top of book.
  function fairFloor(id,market) {
    if(!(market>0))return 0;
    const floor=Math.ceil(market*FAIR),daily=dailyTurnover(id);
    if(!(daily>0))return floor;
    const live=quotes.get(id),top=topOfBook(id);
    const depth=live&&now()-live.at<ttl?live.asks.filter(a=>a.price<floor).reduce((n,a)=>n+a.qty,0):
      top?.ask>0&&top.ask<floor?top.askQty??0:0;
    return depth>=daily?0:floor;
  }
  function listingQuote(p,book,id,floor) {
    const minimum=priceUp(minListPrice(floor,taxBp)),market=marketPrice(id);
    let price=book.asks.length?stepBelow(lowestAsk(book)):market;
    if(market>0&&price!=null)price=Math.min(Math.max(price,fairFloor(id,market)),Math.floor(market*CEILING));
    if(!(price>0))return null;
    price=Math.max(minimum,priceDown(price));
    if(!valid(price)||price>1e9)return null;
    return {price,market,demand:saleDemand(p,book,price,floor)};
  }
  // Someone now sells below our listing, and following them one step stays at
  // or above the fair floor (fairFloor): then it is re-listed; otherwise it waits.
  // So is one above the 115% ceiling (the market price it was listed at proved
  // a freak trade's average).
  const undercut=order=>{const ask=topOfBook(order.itemId)?.ask,market=marketPrice(order.itemId);
    return market>0&&order.price>Math.floor(market*CEILING)||
      ask>0&&ask<order.price&&stepBelow(ask)>=fairFloor(order.itemId,market);};
  const netOf=(price,qty)=>netProceeds(price,qty,taxBp);
  const merchantUnit=id=>merchantPrice(data,id);
  const dayTicks=dayTicksOf(data);
  // Store the latest buyback report; the observed price ratio is what it
  // actually paid relative to the merchant price (capped at 1.5).
  function setBuyback(value,at=now()) {
    const last=value?.last;
    if(!last||!Number.isFinite(last.tick)||!Number.isFinite(last.coins)||!Array.isArray(last.items))return;
    const items=last.items.filter(r=>Number.isSafeInteger(r?.itemId)&&r.itemId>0&&Number.isSafeInteger(r.qty)&&r.qty>0&&data.items[planner.base(r.itemId)]);
    const atMerchant=items.reduce((n,r)=>n+r.qty*merchantUnit(r.itemId),0);
    if(!atMerchant)return;
    buyback={at,tick:last.tick,coins:last.coins,purse:Number.isFinite(value.purse)?value.purse:null,
      ratio:Math.min(1.5,Math.max(1,last.coins/atMerchant)),items:items.map(r=>({itemId:r.itemId,qty:r.qty}))};
  }
  // Buyback terms for an item bought in the last run: daily volume, the
  // observed price ratio, the 1.5x cap and the next run's tick.
  function buybackFor(p,itemId) {
    if(!buyback||now()-buyback.at>6*3600000||itemId!==planner.base(itemId))return null;
    const row=buyback.items.find(r=>r.itemId===itemId);
    if(!row)return null;
    const merchant=merchantUnit(itemId);
    let nextTick=buyback.tick+dayTicks;
    while(nextTick<=p.lastTick)nextTick+=dayTicks;
    return {qty:row.qty,ratio:buyback.ratio,merchant,cap:Math.floor(merchant*1.5),nextTick};
  }
  const buybackHolds=()=>Object.values(state?.owned??{}).filter(o=>o.buyback).length;
  // Could this stock be sold at all, and so what is using it worth giving up
  // (planner.stockValue)? A tradable, unprotected item: on the market (which
  // also takes quality bars, gear and potions), or a common one to the
  // merchant when the market is closed to the character.
  // Quality gear and rare goods sell only at a same-quality market price,
  // never to the merchant: when a fresh price feed shows none (and the helper
  // watched none), nobody buys it. A missing or stale feed proves nothing.
  function saleable(p,id) {
    select(p);
    const base=planner.base(id);
    return tradable(base)&&!saleProtectionReason(data,id,true)&&(id===base||!closed(p)&&!(feedFresh()&&!(marketPrice(id)>0)));
  }
  // Everyday selling sells it.
  const sells=(p,id)=>salesEnabled&&saleable(p,id);
  function listedQuantity(p,itemId) {
    select(p);
    return ordersKnown?orders.filter(o=>o.itemId===itemId&&o.side==='sell')
      .reduce((sum,o)=>sum+o.qtyRemaining,0):null;
  }
  function sale(p,vendorPlan,goal=null,profession='magic') {
    select(p);
    if(closed(p))return defer(closedReason(p));
    const capacitySale=capacitySalesEnabled&&vendorPlan?.capacitySale===true;
    // Output of a task chosen for its sale income is sold even when everyday
    // selling is off; economy marks only those items as profitSale.
    const profitSale=vendorPlan?.profitSale===true;
    if(!salesEnabled&&!capacitySale&&!profitSale)return defer('平时出售已关闭，物品留给玩家处理');
    const scoped=result=>({...result,...(capacitySale?{capacitySale:true}:{}),...(profitSale?{profitSale:true}:{})});
    const intent=vendorPlan?.intent;
    if(intent?.t!=='marketDump')return vendorPlan;
    const id=intent.itemId,marketOnly=id!==planner.base(id);
    const retired=marketOnly?reviewInventory(data,planner,p,goal,profession).items.find(row=>row.itemId===id):null;
    const protectedReason=saleProtectionReason(data,id,marketOnly&&retired?.sellFromBank>0);
    if(protectedReason)return defer(protectedReason);
    if(!tradable(planner.base(id)))return defer('未确认可交易，保留物品');
    if(state.attempt)return defer('交易结果待确认，保留盈余并继续练级');
    if(!ordersKnown)return defer('等待同步市场订单，保留盈余并继续练级');
    const previous=state.sales[id];
    const worn=Object.values(p.equipment??{}).filter(itemId=>itemId===id).length;
    // A re-listed item takes its new surplus along: one order per item.
    const safeQty=Math.min(intent.qty,p.bank[id]??0,retired?.sellFromBank??1000000,
      Math.max(0,quantity(p,id)+worn));
    if(safeQty<=0)return defer('暂无可出售的已确认盈余');
    if(hasOrder(id))return merged(p,id,safeQty)??defer('同类物品已有订单，等待成交并继续练级');
    // One sale per item per review (three hours): output gathers into one
    // larger batch instead of a stop and a small sale on every bank visit. A
    // full bank still sells at once.
    if(!capacitySale&&now()-(state.soldAt?.[id]??-Infinity)<reviewMs)
      return defer(`${labelOf(id)} 3 小时内已卖过一批；攒成一批再卖，继续当前任务`);
    if((cooldowns.get(id)??0)>now())return defer('市场短暂冷却，稍后重新报价');
    if(!slots(p))return slotFor(p,id,safeQty)??defer('挂单槽暂满，保留盈余并继续练级');
    const book=quote(id);
    if(book.waiting)return defer('查询买单与挂售价，等待期间继续练级');
    if(book.fallback)return defer('报价暂不可用，保留盈余并稍后重试');
    if(marketOnly) {
      const what=data.gear.some(g=>g.itemId===planner.base(id))?'淘汰装备':'稀有加工品';
      const offer=equipmentOffer(p,id,safeQty,book);
      if(!offer)return defer(`${what}缺少近期同品质成交参考或需求不足；保留，不转系统回收`);
      status=`${what}按同品质近期成交参考出售，不转系统回收`;
      return scoped({...atBank(p,{t:'marketSell',itemId:id,...offer},
        `出售${what} · ${labelOf(id)} × ${offer.qty}，单价 ${offer.price}`),equipmentSale:{goal,profession}});
    }
    const net=netOf;
    const bid=bidsHighFirst(book).find(row=>
      net(row.price,Math.min(safeQty,row.qty))>intent.floor*Math.min(safeQty,row.qty));
    const listing=listingQuote(p,book,id,intent.floor);
    const takeBid=!!bid&&fairBid(id,bid.price,listing);
    // Town buyback: list one below the cheapest ask, never above 1.5x the
    // merchant price, and hold through the next daily run. Taken only when it
    // pays more than both the bid and a market listing; one attempt per batch,
    // keeping a slot free.
    const bb=buybackFor(p,id);
    if(bb&&!previous?.buyback&&!takeBid&&buybackHolds()<2) {
      const asks=book.asks.map(row=>row.price);
      const price=priceDown(Math.min(bb.cap,asks.length?stepBelow(Math.min(...asks)):bb.cap));
      const minimum=priceUp(minListPrice(intent.floor,taxBp));
      const expected=net(Math.round(bb.merchant*bb.ratio),1);
      if(price>=minimum&&(!bid||net(bid.price,1)<expected)&&(!(listing?.market>0)||net(listing.price,1)<expected)) {
        status='城镇回购：挂单等待下次回购，成交前不降价';
        const hours=Math.max(0,Math.ceil((bb.nextTick-p.lastTick)*data.tickMs/3600000));
        return {...scoped(atBank(p,{t:'marketSell',itemId:id,qty:safeQty,price},
          `城镇回购挂单 · ${itemName(data,id)} × ${safeQty}，单价 ${price}`,false)),
          buyback:{holdUntilTick:bb.nextTick+Math.ceil(3600000/data.tickMs)},
          reason:`上次回购买入 ${bb.qty} 件，均价约商人价 ${bb.ratio.toFixed(2)} 倍；按不超过 1.5 倍（${bb.cap}）挂单，约 ${hours} 小时后回购`};
      }
    }
    if(takeBid&&safeQty>0) {
      status='买单接近市场价，直接成交买单';
      // Every buy order at that price in one sale, not only the first one.
      const depth=book.bids.filter(row=>row.price===bid.price).reduce((n,row)=>n+row.qty,0);
      return scoped(atBank(p,{t:'marketSell',itemId:id,qty:Math.min(safeQty,depth),price:bid.price},
        `市场出售 · ${itemName(data,id)}，单价 ${bid.price}`));
    }
    // No market for it: no trades to price it by (other sellers' asks alone
    // prove no buyer). Output made to be sold, a full bank and a batch the
    // town buyback did not take go to the merchant; anything else is kept.
    if(!(listing?.market>0)&&(profitSale||capacitySale||previous?.buyback)) {
      status='没有市场：按商人价出售';
      return scoped({...vendorPlan,intent:{...intent,qty:safeQty},label:`${previous?.buyback?'回购未成交 · ':'出售给商人 · '}${itemName(data,id)} × ${safeQty}${previous?.buyback?'，卖给商人':''}`,
        reason:`${previous?.buyback?'上次回购没有买下本批挂单；':''}市场上没有这件物品的近期成交价可参考；按商人价（${intent.floor}/件）出售`});
    }
    if(!listing)return defer('没有市场价或卖单可参考，保留物品');
    const {price,demand}=listing;
    if(capacitySale&&inventoryBudget(data,planner,p,goal).freeSlots<=0&&demand.illiquid) {
      status='满仓普通盈余：近期可见成交不足以覆盖排队卖量，转系统回收';
      return scoped({...vendorPlan,intent:{...intent,qty:safeQty},illiquidSale:true,
        label:`滞销普通盈余 · ${itemName(data,id)} × ${safeQty}，系统回收`,
        reason:`仓库已满且近 2 小时可见有效成交 ${demand.volume}，同价或更低卖量 ${demand.ahead}。只处理已扣除保留量的普通盈余`});
    }
    const qty=listSize(id,safeQty);
    if(valid(price)&&price<=1e9&&net(price,qty)>intent.floor*qty) {
      status='按市场价挂单（最低卖单下一档，不低于市场价九成）；被压价才跟一档，其余留在仓库';
      return scoped(atBank(p,{t:'marketSell',itemId:id,qty,price},
        `${previous?'市场重新挂单':'市场挂卖'} · ${itemName(data,id)} × ${qty}，单价 ${price}`,false));
    }
    return defer('没有税后高于回收价的合法挂售价，保留物品');
  }
  function equipmentOffer(p,id,qty,book) {
    if(!book||now()-book.at>=ttl)return null;
    // The market price; without one, the median of the trades seen in 2 hours.
    const prices=(book.trades??[]).filter(row=>row.tick<=p.lastTick&&(p.lastTick-row.tick)*data.tickMs<=recycleMs)
      .map(row=>row.price).sort((a,b)=>a-b);
    const market=marketPrice(id)??prices[Math.floor(prices.length/2)]??null;
    if(!(market>0))return null;
    const vendor=merchantPrice(data,id);
    const minimum=priceUp(Math.max(fairFloor(id,market),minListPrice(vendor,taxBp)));
    const bid=bidsHighFirst(book).find(row=>row.price>=Math.max(minimum,market*BID_FAIR));
    if(bid)return {qty:Math.min(qty,bid.qty),price:bid.price};
    const price=Math.max(minimum,priceDown(Math.min(book.asks.length?stepBelow(lowestAsk(book)):market,Math.floor(market*CEILING))));
    return {qty:listSize(id,qty),price};
  }
  // One purchase rule (balancedPurchase); with procurement off nothing is bought.
  function purchase(p,itemId,qty,goal=null,profession='magic') {
    select(p);
    return procurement?.enabled?balancedPurchase(p,itemId,qty,goal,profession):null;
  }
  function potionBudgetSpent() {
    if(!state)return 0;
    state.potionPurchases=state.potionPurchases.filter(entry=>now()-entry.at<3600000);
    return state.potionPurchases.reduce((sum,entry)=>sum+entry.cost,0);
  }
  // A potion ingredient, when buying it and brewing beats buying the potion.
  // Same safe boundary and live-book check as a potion purchase.
  function restockIngredient(p,itemId,qty,goal=null,priceCap=Infinity,why='') {
    select(p);
    if(!procurement?.enabled||!valid(qty)||!planner.nearBank(p)||p.route||p.path?.length||
      p.enhance||playerQueued(p))return null;
    const result=buy(p,itemId,qty,goal,'买原料自制药水',why||'买原料自制比直接买药水便宜',priceCap);
    return result?.intent?.t==='marketBuy'?{...result,consumablePurchase:true}:null;
  }
  function restockPotion(p,itemId,goal=null,desiredQty=1,uncovered=[],worth=null) {
    select(p);
    return procurement?.enabled?balancedPotion(p,itemId,goal,desiredQty,uncovered,worth):null;
  }
  function issued(before,intent,plan=null) {
    select(before);
    if(closed(before)&&['marketBuy','marketSell','marketCancel','marketDump'].includes(intent.t))return false;
    if(intent.t==='marketBuy'&&!buyableItem(data,intent.itemId))return false;
    const equipmentSale=intent.t==='marketSell'&&plan?.equipmentSale;
    if(['marketSell','marketDump'].includes(intent.t)&&saleProtectionReason(data,intent.itemId,!!equipmentSale||!!plan?.tradeSale))return false;
    if(equipmentSale) {
      const row=reviewInventory(data,planner,before,equipmentSale.goal,equipmentSale.profession).items.find(i=>i.itemId===intent.itemId);
      const offer=equipmentOffer(before,intent.itemId,intent.qty,quotes.get(intent.itemId));
      if(state.attempt||!salesEnabled&&!(capacitySalesEnabled&&plan.capacitySale)&&plan.profitSale!==true||!row?.marketOnly||row.sellFromBank<intent.qty||
        !valid(intent.qty)||!offer||offer.price!==intent.price||offer.qty<intent.qty||!planner.nearBank(before)||
        before.route||before.path?.length||!slots(before)||hasOrder(intent.itemId))return false;
    }
    if(intent.t==='marketDump'&&plan?.illiquidSale) {
      const book=quotes.get(intent.itemId),minimum=priceUp(minListPrice(intent.floor,taxBp));
      const price=Math.max(minimum,book?.asks.length?priceDown(stepBelow(lowestAsk(book))):minimum);
      if(!capacitySalesEnabled||!plan.capacitySale||inventoryBudget(data,planner,before).freeSlots>0||
        !book||now()-book.at>=ttl||!saleDemand(before,book,price,intent.floor).illiquid||
        book.bids.some(row=>netOf(row.price,Math.min(intent.qty,row.qty))>
          intent.floor*Math.min(intent.qty,row.qty)))return false;
    }
    if(intent.t==='marketDump') {
      // Consume this batch's allowance before submission. An uncertain result
      // must not authorize recycling newly produced stock after a refresh.
      delete state.sales[intent.itemId];(state.soldAt??={})[intent.itemId]=now();persist();
      return;
    }
    if(!['marketBuy','marketSell','marketCancel'].includes(intent.t)||state.attempt)return plan?.consumablePurchase||plan?.procurement?false:undefined;
    if(plan?.procurement) {
      const book=quotes.get(intent.itemId),ask=book?.asks.find(row=>row.price===intent.price&&row.qty>=intent.qty);
      const capacity=inventoryBudget(data,planner,before);
      if(!procurement?.enabled||intent.t!=='marketBuy'||!purchasable(intent.itemId)||!valid(intent.qty)||!valid(intent.price)||
        !planner.nearBank(before)||before.route||before.path?.length||before.enhance||before.held||before.raidHeld||before.queue?.length||
        capacity.freeSlots<=0&&!(before.bank[intent.itemId]>0)||!slots(before,'buy')||hasOrder(intent.itemId)||
        !book||now()-book.at>=ttl||!ask||intent.qty*intent.price>purchaseAllowance(before,{budget:{coins:plan.purchaseReserve??0}}))return false;
    } else if(plan?.consumablePurchase) {
      const restock=plan.potionRestock;
      if(intent.t!=='marketBuy'||!restock||!valid(intent.qty)||!valid(intent.price))return false;
      const current=restockPotion(before,intent.itemId,
        {budget:{coins:restock.coins,items:{[intent.itemId]:restock.reserve}}},restock.desiredQty,[],restock.worth);
      if(!current||current.intent.price!==intent.price||current.intent.qty<intent.qty)return false;
    }
    const cancelled=intent.t==='marketCancel'?state.owned[intent.orderId]:null;
    const order=cancelled&&orders.find(o=>ownMatch(o,cancelled));
    const itemId=intent.itemId??cancelled?.itemId;
    state.attempt={intent:{...intent},at:now(),baselineIds:orders.map(o=>o.id),revision,
      cancelledOrder:order?{...cancelled,qtyRemaining:order.qtyRemaining}:cancelled,
      capacitySale:plan?.capacitySale===true,profitSale:plan?.profitSale===true,buyback:plan?.buyback??null,
      equipmentSale:!!equipmentSale,
      reviewSale:!!cancelled&&reviewOrderId===intent.orderId,
      before:{id:before.id,coins:before.coins,quantity:itemId?quantity(before,itemId):0},filled:0};
    if(plan?.procurement&&intent.t==='marketBuy') {
      if(plan.trade){const tr=plan.trade;(state.trades??={})[tr.kind==='enhance'?`line:${tr.line}`:`id:${tr.id}`]={...tr,at:now()};}
      purchaseSpent();state.purchases.push({at:now(),cost:intent.price*intent.qty});
      if(!persist()){state.purchases.pop();state.attempt=null;return false;}
      return true;
    }
    if(plan?.consumablePurchase&&intent.t==='marketBuy') {
      // Reserve the full submitted amount before sending. Rejection or escrow
      // cancellation cannot turn a rolling spending limit into a retry loop.
      potionBudgetSpent();state.potionPurchases.push({at:now(),cost:intent.price*intent.qty});
      if(!persist()) {state.potionPurchases.pop();state.attempt=null;return false;}
      return true;
    }
    if(intent.t==='marketSell')(state.soldAt??={})[intent.itemId]=now();
    persist();
  }
  function confirmed(before,p,intent) {
    select(p);const attempt=state.attempt;
    if(!attempt||JSON.stringify(attempt.intent)!==JSON.stringify(intent))return false;
    if(intent.t==='marketCancel')return ordersKnown&&revision>attempt.revision&&
      !orders.some(o=>o.id===intent.orderId);
    const fresh=ordersKnown&&revision>attempt.revision;
    if(fresh&&orders.filter(o=>!attempt.baselineIds.includes(o.id)&&matching(o,intent)).length===1)return true;
    if((attempt.filled??0)>=intent.qty)return true;
    return fresh&&intent.t==='marketBuy'&&quantity(p,intent.itemId)-attempt.before.quantity>=intent.qty&&
      p.coins<attempt.before.coins;
  }
  function settled(p,intent) {
    select(p);const attempt=state.attempt;
    if(!attempt||!confirmed(null,p,intent))return;
    if(intent.t==='marketCancel') {
      const owned=state.owned[intent.orderId]??attempt.cancelledOrder;
      if(owned) {
        cooldowns.set(owned.itemId,now()+coolMs);
        if(owned.side==='sell') {
          const returned=Math.min(attempt.cancelledOrder?.qtyRemaining??0,
            Math.max(0,quantity(p,owned.itemId)-attempt.before.quantity));
          if(attempt.reviewSale&&returned>0)state.sales[owned.itemId]={qty:returned,stock:quantity(p,owned.itemId),price:owned.price,
            listedMs:(owned.listedMs??0)+Math.max(0,attempt.at-owned.at),rounds:owned.rounds??1,capacitySale:owned.capacitySale===true,profitSale:owned.profitSale===true,buyback:!!owned.buyback};
          else delete state.sales[owned.itemId];
        }
      }
      delete state.owned[intent.orderId];
    } else {
      const created=orders.filter(o=>!attempt.baselineIds.includes(o.id)&&matching(o,intent));
      const previous=intent.t==='marketSell'?state.sales[intent.itemId]:null;
      if(created.length===1)state.owned[created[0].id]={...created[0],at:attempt.at,
        listedMs:previous?.listedMs??0,rounds:(previous?.rounds??0)+1,capacitySale:attempt.capacitySale===true,profitSale:attempt.profitSale===true,equipmentSale:attempt.equipmentSale===true,buyback:attempt.buyback??null};
      if(intent.t==='marketSell')delete state.sales[intent.itemId];
      quotes.delete(intent.itemId);requests.delete(intent.itemId);
    }
    state.attempt=null;persist();
  }
  // An attempt the game never carried out (refused before it was sent, or its
  // item used elsewhere, e.g. converted into house points) shows no new order,
  // no fill and, for a buy, no goods. Kept forever it blocked every trade: a
  // four-day-old sale held off all purchases. After ten minutes with a fresh
  // order list it is released.
  function staleAttempt(p) {
    const attempt=state.attempt;
    if(!attempt||!ordersKnown||!(revision>attempt.revision)||now()-attempt.at<600000||(attempt.filled??0)>0)return false;
    if(attempt.intent.t==='marketCancel')return orders.some(o=>o.id===attempt.intent.orderId);
    if(orders.some(o=>!attempt.baselineIds.includes(o.id)&&matching(o,attempt.intent)))return false;
    return !(attempt.intent.t==='marketBuy'&&quantity(p,attempt.intent.itemId)>(attempt.before?.quantity??0));
  }
  // Trading desk: buy below the market price and resell, or buy, enhance and
  // resell (enhancing runs beside any work). In the background, like selling:
  // it never takes the character off its task (buys wait for a natural stop),
  // ties up at most half the purchase allowance, and runs with 按收益采购 on.
  // Every opportunity is judged at the one market price (marketPrice) and a
  // resale as the sale rule sells: 95% of it after tax, a tenth of a day's
  // turnover at a time. Legendary and protected items are never traded.
  // A resale over 5x the full cost is no market a trade can count on (a 22-gold
  // Bronze rod made +2 'selling' for 178M): it is shown, never traded.
  const TRADE_MARGIN=.1,ENHANCE_MARGIN=.2,RESALE=.95,TRADE_SHARE=.5,ENHANCE_STEPS=10,ANOMALY=5;
  const resaleNet=(id,qty=1)=>{const m=marketPrice(id);return m>0?netOf(Math.floor(m*RESALE),qty)/qty:0;};
  const lineOf=id=>id%data.plusScale; // a piece's base and quality, any +N
  let tradeScan={key:null,rows:[],anomalies:[]};
  function tradeRows(p) {
    if(!feed||now()-feed.at>=feedTtl)return [];
    const key=JSON.stringify([feed.at,p.skills?.enhancing,p.masteries,p.house?.lectern,taxBp]);
    if(tradeScan.key===key)return tradeScan.rows;
    const rows=[],anomalies=[],shard=unitValue(p,data.shardId,1);
    const keep=row=>((row.unit+row.cost)>ANOMALY*row.cost?anomalies:rows).push(row);
    for(const [text,row]of Object.entries(feed.items)) {
      const id=Number(text);
      if(!(row.ask>0)||!(row.askQty>0)||!purchasable(id)||!autoUsableMaterial(data,id)||!saleable(p,id))continue;
      const daily=dailyTurnover(id),unit=resaleNet(id)-row.ask;
      if(daily>0&&unit>=row.ask*TRADE_MARGIN)
        keep({kind:'flip',id,sellId:id,ask:row.ask,qty:Math.min(row.askQty,Math.max(1,Math.floor(daily*LIST_SHARE))),unit,cost:row.ask});
      if(!planner.equipmentStats(id))continue;
      const from=plusOf(data,id);
      for(let k=from+1;k<=Math.min(ENHANCEMENT_MAX,from+ENHANCE_STEPS);k++) {
        const target=lineOf(id)+k*data.plusScale;
        if(!(dailyTurnover(target)>0)||!(marketPrice(target)>0))continue;
        const e=expectedEnhancement(data,planner,p,id,k);
        if(!Number.isFinite(e.gold))break;
        const cost=row.ask+e.gold+e.shards*shard,gain=resaleNet(target)-cost;
        if(gain>=cost*ENHANCE_MARGIN)keep({kind:'enhance',id,sellId:target,ask:row.ask,qty:1,unit:gain,cost,toPlus:k});
      }
    }
    rows.sort((a,b)=>b.unit*b.qty-a.unit*a.qty);anomalies.sort((a,b)=>b.unit-a.unit);
    tradeScan={key,rows:rows.slice(0,20),anomalies:anomalies.slice(0,10)};
    return tradeScan.rows;
  }
  // Open trades (state.trades, keyed by the bought id for a resale, by the
  // piece's line for an enhancement): what is held or listed of it is what is left.
  const tradeHeld=(p,t)=>t.kind==='enhance'?Object.entries(p.bank).filter(([id,n])=>n>0&&lineOf(Number(id))===t.line)
    .map(([id,n])=>({id:Number(id),n})).sort((a,b)=>plusOf(data,b.id)-plusOf(data,a.id)):
    (p.bank[t.id]??0)>0?[{id:t.id,n:p.bank[t.id]}]:[];
  const tradeListed=t=>orders.filter(o=>o.side==='sell'&&(t.kind==='enhance'?lineOf(o.itemId)===t.line:o.itemId===t.id)).reduce((n,o)=>n+o.qtyRemaining,0);
  function trade(p,goal) {
    const trades=state.trades??={};
    for(const [key,t]of Object.entries(trades)) {
      const left=tradeHeld(p,t).reduce((n,h)=>n+h.n,0)+tradeListed(t);
      if(left<=0&&now()-t.at>600000){delete trades[key];persist();}
    }
    for(const t of Object.values(trades)) {
      const held=tradeHeld(p,t)[0];
      if(!held)continue;
      // An enhancement goes on to its target (a failure restarts from +0; the
      // expected cost counted it), one step at a time, beside the work.
      if(t.kind==='enhance'&&plusOf(data,held.id)<t.toPlus) {
        if(p.enhance)return null;
        const quote=enhanceQuote(data,planner,p,held.id);
        if(!(quote.chance>0)||p.coins-coinReserve(planner,p,goal)<quote.gold||quantity(p,data.shardId)<quote.shards){status='倒卖强化：金币或碎片不足，等待';continue;}
        status=`倒卖强化 ${labelOf(held.id)} → +${t.toPlus}`;
        return action({t:'enhance',itemId:held.id,toPlus:plusOf(data,held.id)+1,once:true},
          `倒卖强化 · ${labelOf(held.id)} → +${plusOf(data,held.id)+1}`,`目标 +${t.toPlus} 后按市场价出售`);
      }
      // Resell at the sale rule's price, a tenth of a day's turnover at a time.
      if(hasOrder(held.id)||!slots(p)||(cooldowns.get(held.id)??0)>now())continue;
      const book=quote(held.id);
      if(book.waiting)return wait('倒卖：查询卖盘');
      if(book.fallback)continue;
      const offer=held.id===planner.base(held.id)?(()=>{const l=listingQuote(p,book,held.id,merchantPrice(data,held.id));
        return l?{price:l.price,qty:listSize(held.id,held.n)}:null;})():equipmentOffer(p,held.id,held.n,book);
      if(!offer)continue;
      const sale=atBank(p,{t:'marketSell',itemId:held.id,qty:Math.min(held.n,offer.qty),price:offer.price},
        `倒卖出售 · ${labelOf(held.id)} × ${Math.min(held.n,offer.qty)}，单价 ${offer.price}`,false);
      if(sale.intent)return {...sale,profitSale:true,tradeSale:true};
    }
    // A new trade: the best opportunity that fits the capital left, at a stop.
    if(!procurement?.enabled||state.attempt||!natural(p)||p.enhance)return null;
    const allowance=purchaseAllowance(p,goal),open=Object.values(trades).reduce((n,t)=>n+t.cost,0);
    // At most half the allowance in open trades, a fifth in any one.
    const room=Math.min(allowance*TRADE_SHARE-open,allowance*.2);
    const row=tradeRows(p).find(r=>r.ask*r.qty<=room&&!trades[r.kind==='enhance'?`line:${lineOf(r.id)}`:`id:${r.id}`]&&
      (r.kind!=='enhance'||quantity(p,data.shardId)>=expectedEnhancement(data,planner,p,r.id,r.toPlus).shards));
    if(!row)return null;
    // A resale lists no lower than 90% of the market price: buy only when no
    // seller would be left under that after this purchase, or it never sells.
    if(row.kind==='flip') {
      const book=quote(row.id);
      if(book.waiting)return wait('倒卖：核对实时卖盘');
      if(book.fallback)return null;
      const floor=Math.ceil(marketPrice(row.id)*FAIR),under=book.asks.filter(a=>a.price<floor).reduce((n,a)=>n+a.qty,0);
      if(under>row.qty){status=`倒卖：${labelOf(row.id)} 低价卖单共 ${under}，买不完，转卖时会被压价，跳过`;return null;}
    }
    const result=buy(p,row.id,row.qty,goal,row.kind==='enhance'?'倒卖：买入后强化':'倒卖：低于市场价买入',
      row.kind==='enhance'?`买入后强化到 +${row.toPlus}（期望花费含失败重来），按市场价卖出，预计每件赚约 ${Math.round(row.unit)} 金币`:
        `市场价约 ${marketPrice(row.id)}，挂单卖出预计每件赚约 ${Math.round(row.unit)} 金币（已扣税）`,row.ask);
    if(!result?.intent||result.intent.t!=='marketBuy')return null;
    return {...result,trade:{kind:row.kind,id:row.id,line:lineOf(row.id),toPlus:row.toPlus??null,cost:row.cost*row.qty}};
  }
  function next(p,goal=null,profession='magic') {
    select(p);
    if(closed(p)){status=closedReason(p);return null;}
    if(state.attempt) {
      if(confirmed(null,p,state.attempt.intent))settled(p,state.attempt.intent);
      else if(staleAttempt(p)){state.attempt=null;persist();status='上次交易没有执行（无新挂单、无成交），已解除等待，恢复比价';}
      else {status='交易结果待确认，暂不重发；继续自给';return null;}
    }
    if(!ordersKnown)return null;
    let deferredCancel=null;
    for(const owned of Object.values(state.owned)) {
      const order=orders.find(o=>ownMatch(o,owned));if(!order)continue;
      const returned=owned.equipmentSale?{...p,bank:{...p.bank,[order.itemId]:(p.bank[order.itemId]??0)+order.qtyRemaining}}:null;
      const retired=returned&&reviewInventory(data,planner,returned,goal,profession).items.find(row=>row.itemId===order.itemId);
      if(order.side==='sell'&&(saleProtectionReason(data,order.itemId,!!retired?.marketOnly)||
        owned.equipmentSale&&!(retired?.sellFromBank>=order.qtyRemaining))) {
        reviewOrderId=null;
        return atBank(p,{t:'marketCancel',orderId:order.id},'撤回受保护物品的旧脚本挂单',true);
      }
      if((cooldowns.get(order.itemId)??0)>now())continue;
      if(order.side==='sell'&&orders.filter(o=>o.itemId===order.itemId).length>1) {
        const merge=merged(p,order.itemId,0);
        if(merge?.intent)return merge;
      }
      if(order.side==='sell'&&!salesEnabled&&!(capacitySalesEnabled&&owned.capacitySale===true)&&owned.profitSale!==true) {
        reviewOrderId=null;
        const cancel=atBank(p,{t:'marketCancel',orderId:order.id},'平时出售已关闭，撤回助手自己的挂单');
        if(cancel.intent)return cancel;
        deferredCancel??=cancel;continue;
      }
      const reserves=inventoryBudget(data,planner,p,goal).items;
      const needed=(reserves?.[order.itemId]??0)>quantity(p,order.itemId)||
        (need?.itemId===order.itemId&&now()-need.at<ttl);
      // A buyback listing is held, not re-priced, until just after the next daily run.
      if(order.side==='sell'&&!needed&&owned.buyback&&p.lastTick<owned.buyback.holdUntilTick)continue;
      // A listing whose week of trades was never seen gets its book read once
      // per review (the week's median checks the price it was listed at).
      if(order.side==='sell'&&now()-(owned.bookAt??owned.at)>=reviewMs&&history.tradeMedian(order.itemId)==null&&!requests.has(order.itemId)) {
        owned.bookAt=now();requests.set(order.itemId,{at:now(),sentAt:null,review:true});
      }
      // A buyback listing past its run is reviewed like any other batch.
      if(order.side==='buy'||needed||now()-owned.at>=reviewMs&&(undercut(order)||!!owned.buyback)) {
        reviewOrderId=order.side==='sell'&&!needed?order.id:null;
        return atBank(p,{t:'marketCancel',orderId:order.id},order.side==='buy'?
          '撤销采购余单，释放剩余金币':needed?'撤回自有挂单 · 当前计划需要':'被压价：撤回后跟到最低卖单下一档',
          order.side==='buy'||needed);
      }
    }
    return deferredCancel??trade(p,goal);
  }
  function setAutoSell(enabled) {
    salesEnabled=enabled===true;
    if(!salesEnabled) {
      watched=[];priorityItem=null;watchCursor=0;reviewOrderId=null;
      for(const [id,request]of requests)if(request.background)requests.delete(id);
    }
    status=salesEnabled?'按市场价挂单；被压价才跟一档，不追低价':'平时出售已关闭，物品留给玩家处理';
  }
  function setCapacitySales(enabled) {capacitySalesEnabled=enabled===true;}
  function rejected(code) {
    refresh();
    if(code==='email-needed'||code==='email-changed') {
      if(state){state.tradeGateUntil=now()+gateMs;state.attempt=null;status=closedReason({});persist();}
      return;
    }
    const known=['too-fast','not-at-bank','price-changed','not-tradable','too-many-orders','cannot-afford',
      'below-floor','nothing-to-sell','no-such-order','storage-full','bank-full','pack-full',
      'nothing-to-deposit','nothing-to-withdraw','nothing-to-eat','cannot-enhance','cannot-fight',
      'cannot-set-route','cannot-wield','cannot-equip','level-too-low','market-price-step'];
    if(!state?.attempt||!known.includes(code))return;
    const intent=state.attempt.intent,owned=state.owned[intent.orderId];
    const id=intent.itemId??owned?.itemId;
    if(id!=null){cooldowns.set(id,now()+coolMs);quotes.delete(id);requests.delete(id);tops.delete(id);bookRequests.delete(id);}
    state.attempt=null;status='市场暂不可用，短暂冷却后再比价';persist();
  }
  const buybackSummary=()=>{
    if(!buyback)return '';
    const held=buybackHolds(),hours=Math.round((buyback.tick+dayTicks-snapshotTick)*data.tickMs/3600000);
    return `；城镇回购：上次买入 ${buyback.items.length} 种，均价约商人价 ${buyback.ratio.toFixed(2)} 倍`+
      (Number.isFinite(hours)&&hours>0?`，约 ${hours} 小时后再次回购`:'')+(held?`，等待回购的挂单 ${held} 笔`:'');
  };
  const feedSummary=()=>!feed?'；价格总表未取得，估值按实时报价或公式':now()-feed.at<feedTtl?
    `；价格总表 ${Math.max(0,Math.floor((now()-feed.at)/60000))} 分钟前更新，仅用于估值，下单前核对实时盘口`:'；价格总表已过期，估值按实时报价或公式';
  const summary=()=>`${status}${buybackSummary()}${feedSummary()}；成交净收入 ${state?.income??0}，采购支出 ${state?.spent??0}，自有挂单 ${Object.keys(state?.owned??{}).length}；近一小时补药承诺 ${potionBudgetSpent()}`+
    (procurement?.enabled?`；按收益／节时采购，无固定金币底线和小时限额；近一小时承诺 ${purchaseSpent()}`:'');
  function runtime(value) {
    if(value) {({saved,savedText,storageReadable,playerId,orders,ordersKnown,revision,taxBp,snapshotTick,quotes,requests,cooldowns,lastQuery,lastSync,procurement,tops,bookRequests,equipmentScan,foodScan,watched,potionWatched,watchCursor,priorityItem,salesEnabled,capacitySalesEnabled,need,recentOwned,reviewOrderId,status}=value);if('buyback' in value)buyback=value.buyback;if('feed' in value)feed=value.feed;if(value.history)history.adopt(value.history);state=playerId===null?null:playerState(playerId);}
    return {saved,savedText,storageReadable,playerId,orders,ordersKnown,revision,taxBp,snapshotTick,quotes,requests,cooldowns,lastQuery,lastSync,procurement,tops,bookRequests,equipmentScan,foodScan,watched,potionWatched,watchCursor,priorityItem,salesEnabled,capacitySalesEnabled,need,recentOwned,reviewOrderId,status,buyback,feed,history:history.state()};
  }
  // deepveinDebug(): the store's size and age, and each watched sale item at a glance.
  const historyReport=()=>({...history.summary(),watched:Object.fromEntries(watched.map(id=>[itemName(data,id),history.describe(id)]))});
  return {runtime,receive,next,sale,purchase,restockPotion,restockIngredient,potionStatus,potionBudgetSpent,query,watch,watchPotions,opportunity,listedQuantity,issued,confirmed,settled,rejected,summary,setAutoSell,setCapacitySales,setBuyback,setPriceFeed,unitValue,askPrice,closed,sells,saleable,tradeRows,tradeAnomalies:()=>tradeScan.anomalies,priceFeedAge:()=>feed?now()-feed.at:null,
    averagePrice:history.averagePrice,dailyVolume:history.dailyVolume,priceTrend:history.priceTrend,historyReport,
    configureProcurement,equipmentPurchase,foodPurchase,buffFood,potionDose,marketBuyPrice,surplusValue,watchPurchases:scan,
    purchaseAllowance:(p,goal)=>{select(p);return purchaseAllowance(p,goal);}};
}
