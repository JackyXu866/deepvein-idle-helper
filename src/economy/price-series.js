// Every listed item's prices once an hour, from the public price feed
// (/api/market/prices.json): its book price (lowest ask, else best bid) and
// its best bid. The last week stays in memory and gives each item, as the
// higher of the week's and the last day's median (so a real rise is followed
// within a day, while a freak hour or a lone dump moves nothing):
// - `bookMedian`: its typical book price, which checks the feed's 7-day
//   average for every item, not only the few whose live book was read, and
//   caps an ask spike when valuing a listing;
// - `typicalBid`: its typical best bid, against which a bid spike is capped
//   when valuing future output.
// Thirty days are kept on disk (IndexedDB, the page only) for later
// analysis; the Worker gets the medians with the market runtime.
export const PRICE_SERIES_DB='deepvein-price-series';
const HOUR=3600000,DAY_HOURS=24,WEEK=168,KEEP_HOURS=30*24;
// Half a day of hourly samples before a median is trusted.
export const MIN_SERIES_SAMPLES=12;
const STRIDE=3; // [hour, book, bid] per sample; 0 = none

const median=values=>{
  if(values.length<MIN_SERIES_SAMPLES)return null;
  values.sort((a,b)=>a-b);return values[(values.length-1)>>1];
};

export function createPriceSeries({now=Date.now,store=null}={}) {
  // id -> flat [hour, book, bid, hour, book, bid, ...], oldest first, the last week.
  let samples=new Map(),medians={book:{},bid:{}},lastHour=null,firstHour=null;
  const hourNow=()=>Math.floor(now()/HOUR);
  function append(hour,rows) {
    for(const [id,ask,bid]of rows) {
      const book=ask>0?ask:bid>0?bid:0;if(!book)continue;
      let list=samples.get(id);if(!list)samples.set(id,list=[]);
      list.push(hour,book,bid>0?bid:0);
    }
  }
  function refresh() {
    const current=hourNow(),cutoff=current-WEEK,next={book:{},bid:{}};
    for(const [id,list]of samples) {
      let start=0;while(start<list.length&&list[start]<=cutoff)start+=STRIDE;
      const kept=start?list.slice(start):list;
      if(!kept.length){samples.delete(id);continue;}
      if(start)samples.set(id,kept);
      const books=[],dayBooks=[],bids=[],dayBids=[];
      for(let i=0;i<kept.length;i+=STRIDE) {
        const day=kept[i]>current-DAY_HOURS;
        books.push(kept[i+1]);if(day)dayBooks.push(kept[i+1]);
        if(kept[i+2]>0){bids.push(kept[i+2]);if(day)dayBids.push(kept[i+2]);}
      }
      const book=Math.max(median(books)??0,median(dayBooks)??0),bid=Math.max(median(bids)??0,median(dayBids)??0);
      if(book)next.book[id]=book;
      if(bid)next.bid[id]=bid;
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
      .filter(([id,ask,bid])=>Number.isSafeInteger(id)&&(ask>0||bid>0));
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
    const older=(records??[]).filter(r=>Number.isFinite(r?.hour)&&Array.isArray(r.rows)&&(firstHour==null||r.hour<firstHour))
      .sort((a,b)=>a.hour-b.hour);
    if(!older.length)return false;
    const session=samples;samples=new Map();
    for(const r of older)append(r.hour,r.rows);
    for(const [id,list]of session){const before=samples.get(id);samples.set(id,before?before.concat(list):list);}
    lastHour=Math.max(lastHour??-Infinity,older.at(-1).hour);
    refresh();
    return true;
  }
  const bookMedian=id=>medians.book[id]??null;
  const typicalBid=id=>medians.bid[id]??null;
  // Runtime transfer (page -> Worker): the medians only.
  const adopt=value=>{if(value?.book&&value?.bid)medians=value;};
  const summary=()=>({items:samples.size,bookMedians:Object.keys(medians.book).length,bidMedians:Object.keys(medians.bid).length,
    lastHourAgo:lastHour==null?null:hourNow()-lastHour,stored:!!store});
  const describe=id=>({bookMedian:bookMedian(id),typicalBid:typicalBid(id),samples:(samples.get(id)?.length??0)/STRIDE});
  return {record,load,bookMedian,typicalBid,medians:()=>medians,adopt,summary,describe};
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
