// Rolling market history per item id, so valuations can lean on several days
// instead of one snapshot: the price feed's best ask and bid (one sample per
// feed, every 5 minutes while a tab is open) and what queried live books traded.
// Three-hour buckets for the last day, daily buckets for the six days before,
// at most `limit` ids. Trades are seen only for books the helper asked for, so
// volumes are observed lower bounds, not the whole market's turnover.
export const MARKET_HISTORY_KEY='deepvein-market-history-v1';
const HOUR=3600000,DAY=24*HOUR,RECENT=24,KEEP=168;
// A bucket: [start hour, askN, askSum, askMin, askMax, bidN, bidSum, bidMin, bidMax, tradeQty, tradeValue].
const SIDE={ask:1,bid:5},QTY=9,VALUE=10,FIELDS=11;
const blank=()=>({v:1,feedAt:null,items:{}});
const lower=(a,b)=>a==null?b:b==null?a:Math.min(a,b);
const upper=(a,b)=>a==null?b:b==null?a:Math.max(a,b);
function merge(into,b) {
  for(const s of [1,5]){into[s]+=b[s];into[s+1]+=b[s+1];into[s+2]=lower(into[s+2],b[s+2]);into[s+3]=upper(into[s+3],b[s+3]);}
  into[QTY]+=b[QTY];into[VALUE]+=b[VALUE];
}
const validBucket=b=>Array.isArray(b)&&b.length===FIELDS&&b.every((n,i)=>n===null?[3,4,7,8].includes(i):Number.isFinite(n));
const validItem=item=>item&&typeof item==='object'&&Array.isArray(item.recent)&&Array.isArray(item.days)&&
  [...item.recent,...item.days].every(validBucket);

export function createMarketHistory({now=Date.now,limit=400}={}) {
  let state=blank();
  const hourNow=()=>Math.floor(now()/HOUR);
  function entry(id) {
    const key=String(id);
    if(!state.items[key]&&Object.keys(state.items).length>=limit)return null;
    return state.items[key]??={recent:[],days:[],tradeTick:null,since:null};
  }
  // Old three-hour buckets fold into their day; days past a week are dropped,
  // and an id with nothing left is forgotten (it frees a place under the limit).
  function compact(key) {
    const item=state.items[key],current=hourNow();
    for(const b of item.recent.filter(b=>b[0]<current-RECENT)) {
      const start=b[0]-b[0]%24;let day=item.days.find(d=>d[0]===start);
      if(!day){day=[start,0,0,null,null,0,0,null,null,0,0];item.days.push(day);}
      merge(day,b);
    }
    item.recent=item.recent.filter(b=>b[0]>=current-RECENT);
    item.days=item.days.filter(b=>b[0]+24>current-KEEP).sort((a,b)=>a[0]-b[0]);
    if(!item.recent.length&&!item.days.length&&!(item.since>now()-KEEP*HOUR))delete state.items[key];
  }
  function add(item,at,fill) {
    const hour=Math.floor(at/HOUR),current=hourNow();
    if(!Number.isFinite(hour)||hour<current-KEEP||hour>current+1)return;
    const recent=hour>=current-RECENT,list=recent?item.recent:item.days,start=hour-hour%(recent?3:24);
    let b=list.find(b=>b[0]===start);
    if(!b){b=[start,0,0,null,null,0,0,null,null,0,0];list.push(b);list.sort((x,y)=>x[0]-y[0]);}
    fill(b);
  }
  // One sample per distinct feed; `rows` is [[id,{ask,bid}],...], most wanted first.
  function recordFeed(rows,at) {
    if(!Number.isFinite(at)||state.feedAt!=null&&at<=state.feedAt)return false;
    state.feedAt=at;
    for(const [id,row]of rows) {
      if(!(row.ask>0)&&!(row.bid>0))continue;
      const item=entry(id);if(!item)continue;
      add(item,at,b=>{for(const side of ['ask','bid'])if(row[side]>0) {
        const s=SIDE[side];b[s]++;b[s+1]+=row[side];b[s+2]=lower(b[s+2],row[side]);b[s+3]=upper(b[s+3],row[side]);
      }});
    }
    for(const key of Object.keys(state.items))compact(key);
    return true;
  }
  // A live book's recent trades ({price,qty,tick}); `tick` is the frame's tick.
  // Only trades newer than the last recorded one count, so repeated quotes of
  // the same book add nothing. Coverage starts at the oldest trade first seen.
  function recordTrades(id,trades,tick,tickMs,at=now()) {
    const item=entry(id);if(!item||!Number.isFinite(tick)||!(tickMs>0))return false;
    const fresh=trades.filter(r=>r.tick<=tick&&(item.tradeTick==null||r.tick>item.tradeTick));
    const time=r=>at-(tick-r.tick)*tickMs;
    for(const r of fresh)add(item,time(r),b=>{b[QTY]+=r.qty;b[VALUE]+=r.qty*r.price;});
    if(fresh.length)item.tradeTick=Math.max(item.tradeTick??-Infinity,...fresh.map(r=>r.tick));
    item.since??=Math.min(at,...trades.filter(r=>r.tick<=tick).map(time));
    compact(String(id));
    return fresh.length>0;
  }
  function buckets(id,hours) {
    const item=state.items[String(id)],cutoff=hourNow()-hours;
    return item?[...item.days.filter(b=>b[0]+24>cutoff),...item.recent.filter(b=>b[0]+3>cutoff)]:[];
  }
  // Average, low and high of one side's feed samples over the last `hours`.
  function priceStats(id,{side='bid',hours=KEEP}={}) {
    const s=SIDE[side];if(!s)return null;
    let n=0,sum=0,min=null,max=null;
    for(const b of buckets(id,hours)){n+=b[s];sum+=b[s+1];min=lower(min,b[s+2]);max=upper(max,b[s+3]);}
    return n?{avg:sum/n,min,max,samples:n}:null;
  }
  const averagePrice=(id,options)=>priceStats(id,options)?.avg??null;
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
  // The last day's average against the week's; null without samples from
  // before the last day (no trend to speak of yet).
  function priceTrend(id,{side='bid'}={}) {
    const week=averagePrice(id,{side,hours:KEEP}),day=averagePrice(id,{side,hours:RECENT});
    const older=state.items[String(id)]?.days.some(b=>b[SIDE[side]]>0);
    return older&&week>0&&day>0?day/week:null;
  }
  // Runtime transfer (page <-> Worker) hands over the object as is; storage is
  // parsed and checked, and anything malformed starts an empty history.
  function adopt(value){if(value?.v===1&&value.items)state=value;}
  function load(text) {
    try {
      const value=JSON.parse(text??'null');
      state=value?.v===1&&value.items&&typeof value.items==='object'&&Object.values(value.items).every(validItem)?value:blank();
    } catch {state=blank();}
    for(const key of Object.keys(state.items))compact(key);
  }
  const text=()=>JSON.stringify(state);
  function summary() {
    const ids=Object.keys(state.items),hours=ids.flatMap(key=>[...state.items[key].days,...state.items[key].recent].map(b=>b[0]));
    return {items:ids.length,oldestHours:hours.length?hourNow()-Math.min(...hours):null,
      lastFeedAgoMin:state.feedAt==null?null:Math.round((now()-state.feedAt)/60000),
      watchedTrades:ids.filter(key=>state.items[key].since!=null).length,kb:Math.round(text().length/1024)};
  }
  // One item at a glance (debug): week and day averages, trades and trend.
  function describe(id) {
    const round=n=>n==null?null:Math.round(n*100)/100;
    return {bid7d:round(averagePrice(id,{side:'bid'})),ask7d:round(averagePrice(id,{side:'ask'})),
      bid24h:round(averagePrice(id,{side:'bid',hours:RECENT})),ask24h:round(averagePrice(id,{side:'ask',hours:RECENT})),
      tradePrice:round(tradePrice(id)),dailyVolume:round(dailyVolume(id)),trend:round(priceTrend(id))};
  }
  return {recordFeed,recordTrades,priceStats,averagePrice,tradePrice,dailyVolume,priceTrend,
    adopt,load,text,summary,describe,state:()=>state};
}
