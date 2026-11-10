// Every listed item's book price once an hour, from the public price feed
// (/api/market/prices.json): its lowest ask, else its best bid. The last week
// stays in memory and gives each item the median of its hourly book prices
// (`bookMedian`), which checks the feed's 7-day average for every item, not
// only the few whose live book was read. Thirty days are kept on disk
// (IndexedDB, the page only) for later analysis; the Worker gets the medians
// with the market runtime.
export const PRICE_SERIES_DB='deepvein-price-series';
const HOUR=3600000,WEEK=168,KEEP_HOURS=30*24;
// Half a day of hourly samples before a median is trusted.
export const MIN_SERIES_SAMPLES=12;

export function createPriceSeries({now=Date.now,store=null}={}) {
  // id -> flat [hour, price, hour, price, ...], oldest first, the last week.
  let samples=new Map(),medians={},lastHour=null,firstHour=null;
  const hourNow=()=>Math.floor(now()/HOUR);
  const bookPrice=(ask,bid)=>ask>0?ask:bid>0?bid:null;
  function append(hour,rows) {
    for(const [id,ask,bid]of rows) {
      const price=bookPrice(ask,bid);if(!price)continue;
      let list=samples.get(id);if(!list)samples.set(id,list=[]);
      list.push(hour,price);
    }
  }
  function refresh() {
    const cutoff=hourNow()-WEEK,next={};
    for(const [id,list]of samples) {
      let start=0;while(start<list.length&&list[start]<=cutoff)start+=2;
      const kept=start?list.slice(start):list;
      if(!kept.length){samples.delete(id);continue;}
      if(start)samples.set(id,kept);
      if(kept.length/2>=MIN_SERIES_SAMPLES) {
        const prices=[];for(let i=1;i<kept.length;i+=2)prices.push(kept[i]);
        prices.sort((a,b)=>a-b);next[id]=prices[(prices.length-1)>>1];
      }
    }
    medians=next;
  }
  // One sample per hour: the first feed of each hour. `items` is the parsed
  // feed ({id: {ask, bid}}), `at` its own generation time.
  function record(items,at) {
    const hour=Math.floor(at/HOUR);
    if(!Number.isFinite(hour)||lastHour!=null&&hour<=lastHour)return false;
    lastHour=hour;firstHour??=hour;
    const rows=Object.entries(items).map(([key,row])=>[Number(key),row?.ask??null,row?.bid??null])
      .filter(([id,ask,bid])=>Number.isSafeInteger(id)&&bookPrice(ask,bid));
    append(hour,rows);refresh();
    if(store){store.put(hour,rows);store.prune(hour-KEEP_HOURS);}
    return true;
  }
  // The stored week, read once at start: hours before this session's first
  // sample go in front of it.
  async function load() {
    if(!store)return false;
    let records=[];
    try{records=await store.since(hourNow()-WEEK);}catch{return false;}
    const older=records.filter(r=>Number.isFinite(r?.hour)&&Array.isArray(r.rows)&&(firstHour==null||r.hour<firstHour))
      .sort((a,b)=>a.hour-b.hour);
    if(!older.length)return false;
    const session=samples;samples=new Map();
    for(const r of older)append(r.hour,r.rows);
    for(const [id,list]of session){const before=samples.get(id);samples.set(id,before?before.concat(list):list);}
    lastHour=Math.max(lastHour??-Infinity,older.at(-1).hour);
    refresh();
    return true;
  }
  const bookMedian=id=>medians[id]??null;
  // Runtime transfer (page -> Worker): the medians only.
  const adopt=value=>{if(value&&typeof value==='object')medians=value;};
  const summary=()=>({items:samples.size,medians:Object.keys(medians).length,
    lastHourAgo:lastHour==null?null:hourNow()-lastHour,stored:!!store});
  return {record,load,bookMedian,medians:()=>medians,adopt,summary};
}

// The page's disk store: one record per hour ({hour, rows: [[id, ask, bid]]}).
// Every failure is silent: the series then lives in memory only.
export function indexedDbStore(idb) {
  if(!idb?.open)return null;
  let opening=null;
  const db=()=>opening??=new Promise((resolve,reject)=>{
    const request=idb.open(PRICE_SERIES_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('hours'))request.result.createObjectStore('hours',{keyPath:'hour'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const run=(mode,work)=>db().then(d=>new Promise((resolve,reject)=>{
    const tx=d.transaction('hours',mode),result=work(tx.objectStore('hours'));
    tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  }));
  return {
    put:(hour,rows)=>{run('readwrite',s=>s.put({hour,rows})).catch(()=>{});},
    prune:before=>{run('readwrite',s=>s.delete(IDBKeyRange.upperBound(before,true))).catch(()=>{});},
    since:hour=>run('readonly',s=>s.getAll(IDBKeyRange.lowerBound(hour))),
  };
}
