// What the live books the helper read traded, per item id: the week's trades
// (three-hour buckets for the last day, daily buckets for the six days
// before) and their quantity-weighted median. Trades are seen only for books
// the helper asked for, so volumes are observed lower bounds, not the whole
// market's turnover. Feed prices (asks and bids) live in price-series.js.
export const MARKET_HISTORY_KEY='deepvein-market-history-v1';
const HOUR=3600000,DAY=24*HOUR,RECENT=24,KEEP=168;
// A bucket: [start hour, tradeQty, tradeValue].
const QTY=1,VALUE=2,FIELDS=3;
const blank=()=>({v:2,items:{}});
const validBucket=b=>Array.isArray(b)&&b.length===FIELDS&&b.every(Number.isFinite);
const validItem=item=>item&&typeof item==='object'&&Array.isArray(item.recent)&&Array.isArray(item.days)&&
  [...item.recent,...item.days].every(validBucket);
// Version 1 also held feed samples ([hour, ask x4, bid x4, qty, value]):
// only its trades and medians are kept.
function upgrade(value) {
  if(value?.v!==1||!value.items||typeof value.items!=='object')return value;
  const trades=list=>(Array.isArray(list)?list:[]).filter(b=>Array.isArray(b)&&b.length===11&&b[9]>0)
    .map(b=>[b[0],b[9],b[10]]);
  const items={};
  for(const [key,item]of Object.entries(value.items)) {
    const next={recent:trades(item?.recent),days:trades(item?.days),tradeTick:item?.tradeTick??null,since:item?.since??null,
      ...(item?.median?{median:item.median}:{})};
    if(next.recent.length||next.days.length||next.median||next.since!=null)items[key]=next;
  }
  return {v:2,items};
}

export function createMarketHistory({now=Date.now,limit=400}={}) {
  let state=blank();
  const hourNow=()=>Math.floor(now()/HOUR);
  // The hour an item was last seen: its newest bucket, or its median's read.
  const lastSeen=item=>Math.max(-Infinity,...[...item.recent,...item.days].map(b=>b[0]),
    item.median?Math.floor(item.median.at/HOUR):-Infinity);
  // A full history makes room for a book read (its trades, its median) by
  // dropping the id seen longest ago (2026-11-08: with 400 ids held, rare
  // Pelt chaps' median was never stored and a freak trade's average stood).
  function entry(id) {
    const key=String(id);
    if(!state.items[key]&&Object.keys(state.items).length>=limit) {
      const oldest=Object.keys(state.items).reduce((a,b)=>lastSeen(state.items[b])<lastSeen(state.items[a])?b:a);
      delete state.items[oldest];
    }
    return state.items[key]??={recent:[],days:[],tradeTick:null,since:null};
  }
  // Old three-hour buckets fold into their day; days past a week are dropped,
  // and an id with nothing left is forgotten (it frees a place under the limit).
  function compact(key) {
    const item=state.items[key],current=hourNow();
    for(const b of item.recent.filter(b=>b[0]<current-RECENT)) {
      const start=b[0]-b[0]%24;let day=item.days.find(d=>d[0]===start);
      if(!day){day=[start,0,0];item.days.push(day);}
      day[QTY]+=b[QTY];day[VALUE]+=b[VALUE];
    }
    item.recent=item.recent.filter(b=>b[0]>=current-RECENT);
    item.days=item.days.filter(b=>b[0]+24>current-KEEP).sort((a,b)=>a[0]-b[0]);
    if(!item.recent.length&&!item.days.length&&!(item.since>now()-KEEP*HOUR)&&
      !(item.median&&now()-item.median.at<DAY))delete state.items[key];
  }
  function add(item,at,qty,value) {
    const hour=Math.floor(at/HOUR),current=hourNow();
    if(!Number.isFinite(hour)||hour<current-KEEP||hour>current+1)return;
    const recent=hour>=current-RECENT,list=recent?item.recent:item.days,start=hour-hour%(recent?3:24);
    let b=list.find(b=>b[0]===start);
    if(!b){b=[start,0,0];list.push(b);list.sort((x,y)=>x[0]-y[0]);}
    b[QTY]+=qty;b[VALUE]+=value;
  }
  // A live book's recent trades ({price,qty,tick}); `tick` is the frame's tick.
  // Only trades newer than the last recorded one count, so repeated quotes of
  // the same book add nothing. Coverage starts at the oldest trade first seen.
  // The book's trades of the last week also give their quantity-weighted median
  // (`tradeMedian`), which one freak trade cannot move.
  function recordTrades(id,trades,tick,tickMs,at=now()) {
    if(!Number.isFinite(tick)||!(tickMs>0))return false;
    const item=entry(id);
    const fresh=trades.filter(r=>r.tick<=tick&&(item.tradeTick==null||r.tick>item.tradeTick));
    const time=r=>at-(tick-r.tick)*tickMs;
    for(const r of fresh)add(item,time(r),r.qty,r.qty*r.price);
    if(fresh.length)item.tradeTick=Math.max(item.tradeTick??-Infinity,...fresh.map(r=>r.tick));
    item.since??=Math.min(at,...trades.filter(r=>r.tick<=tick).map(time));
    const week=trades.filter(r=>r.tick<=tick&&(tick-r.tick)*tickMs<=KEEP*HOUR).sort((a,b)=>a.price-b.price);
    const total=week.reduce((n,r)=>n+r.qty,0);let seen=0;
    const median=week.find(r=>(seen+=r.qty)*2>=total)?.price;
    if(median>0)item.median={price:median,at};
    compact(String(id));
    return fresh.length>0;
  }
  // A median is trusted for a day; after that the next book read refreshes it.
  const tradeMedian=id=>{const m=state.items[String(id)]?.median;return m&&now()-m.at<DAY?m.price:null;};
  function buckets(id,hours) {
    const item=state.items[String(id)],cutoff=hourNow()-hours;
    return item?[...item.days.filter(b=>b[0]+24>cutoff),...item.recent.filter(b=>b[0]+3>cutoff)]:[];
  }
  // Volume-weighted price of the trades seen over the last `hours`.
  function tradePrice(id,{hours=KEEP}={}) {
    let qty=0,value=0;for(const b of buckets(id,hours)){qty+=b[QTY];value+=b[VALUE];}
    return qty?value/qty:null;
  }
  // Units traded per day over the time trades have been watched; null until
  // they have been watched for a day (a few hours say little about a day).
  function dailyVolume(id,{hours=KEEP}={}) {
    const item=state.items[String(id)];if(item?.since==null||now()-item.since<DAY)return null;
    const watched=Math.min(Math.max(hours,RECENT)*HOUR,now()-item.since);
    return buckets(id,hours).reduce((n,b)=>n+b[QTY],0)/(watched/DAY);
  }
  // Runtime transfer (page <-> Worker) hands over the object as is; storage is
  // parsed and checked, and anything malformed starts an empty history.
  function adopt(value){if(value?.v===2&&value.items)state=value;}
  function load(text) {
    try {
      const value=upgrade(JSON.parse(text??'null'));
      state=value?.v===2&&value.items&&typeof value.items==='object'&&Object.values(value.items).every(validItem)?value:blank();
    } catch {state=blank();}
    for(const key of Object.keys(state.items))compact(key);
  }
  const text=()=>JSON.stringify(state);
  function summary() {
    const ids=Object.keys(state.items);
    return {items:ids.length,medians:ids.filter(key=>tradeMedian(key)!=null).length,
      watchedTrades:ids.filter(key=>state.items[key].since!=null).length,kb:Math.round(text().length/1024)};
  }
  // One item at a glance (debug).
  function describe(id) {
    const round=n=>n==null?null:Math.round(n*100)/100;
    return {tradePrice:round(tradePrice(id)),tradeMedian:round(tradeMedian(id)),dailyVolume:round(dailyVolume(id))};
  }
  return {recordTrades,tradeMedian,tradePrice,dailyVolume,adopt,load,text,summary,describe,state:()=>state};
}
