// ==UserScript==
// @name         Deep Vein Idle 世界 Boss 与种菜助手
// @namespace    local.deepvein.field-boss
// @version      0.2.2
// @description  独立世界 Boss 与原生整批收菜；本机参战时段、每轮跳过概率、分组成熟、随机延迟；默认暂停
// @homepageURL  https://github.com/ljyoukong-cpu/deepvein-idle-helper
// @updateURL    https://raw.githubusercontent.com/ljyoukong-cpu/deepvein-idle-helper/main/deepvein-field-boss.meta.js
// @downloadURL  https://raw.githubusercontent.com/ljyoukong-cpu/deepvein-idle-helper/main/deepvein-field-boss.user.js
// @match        https://deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(function(){
'use strict';
const SCRIPT_VERSION="0.2.2";
const GAME_DATA={"protocol":3,"tickMs":600,"xp":{"journeyLevel":99,"baseXp":100,"growth":1.12,"beyondStep":0.1,"beyondGrowth":1.145,"speedPerLevelAboveRequirement":0.005},"farmUnlocks":[1,1,15,30,45,60],"farmWaterTrim":20,"farmGates":{"387":{"name":"林间田","skill":"woodcutting","level":75,"x":152,"y":32},"389":{"name":"沼泽花园","skill":"fishing","level":75,"x":180,"y":118},"391":{"name":"弓手台地","skill":"fletching","level":70,"x":208,"y":30},"393":{"name":"深处花园","skill":"mining","level":85,"x":251,"y":51}},"plusScale":10000,"rarityScale":1000,"jobs":[{"id":160,"name":"Potato","skill":"farming","group":"Crops","levelReq":1,"baseTicks":2,"xp":110,"inputs":[{"itemId":160,"qty":1}],"output":{"itemId":170,"qty":1},"grow":800},{"id":161,"name":"Glowcap","skill":"farming","group":"Crops","levelReq":15,"baseTicks":2,"xp":380,"inputs":[{"itemId":161,"qty":1}],"output":{"itemId":171,"qty":1},"grow":1500},{"id":162,"name":"Cave turnip","skill":"farming","group":"Crops","levelReq":30,"baseTicks":2,"xp":900,"inputs":[{"itemId":162,"qty":1}],"output":{"itemId":172,"qty":1},"grow":2500},{"id":163,"name":"Bitterroot","skill":"farming","group":"Crops","levelReq":45,"baseTicks":2,"xp":1900,"inputs":[{"itemId":163,"qty":1}],"output":{"itemId":173,"qty":1},"grow":4000},{"id":164,"name":"Voidmelon","skill":"farming","group":"Crops","levelReq":60,"baseTicks":2,"xp":3800,"inputs":[{"itemId":164,"qty":1}],"output":{"itemId":174,"qty":1},"grow":6000},{"id":165,"name":"Ember pepper","skill":"farming","group":"Crops","levelReq":75,"baseTicks":2,"xp":6500,"inputs":[{"itemId":165,"qty":1}],"output":{"itemId":175,"qty":1},"grow":9000},{"id":210,"name":"Sage","skill":"farming","group":"Herbs","levelReq":10,"baseTicks":2,"xp":260,"inputs":[{"itemId":190,"qty":1}],"output":{"itemId":193,"qty":1},"grow":1200},{"id":211,"name":"Nightshade","skill":"farming","group":"Herbs","levelReq":35,"baseTicks":2,"xp":1200,"inputs":[{"itemId":191,"qty":1}],"output":{"itemId":194,"qty":1},"grow":3000},{"id":212,"name":"Dragonleaf","skill":"farming","group":"Herbs","levelReq":65,"baseTicks":2,"xp":4600,"inputs":[{"itemId":192,"qty":1}],"output":{"itemId":195,"qty":1},"grow":7000}],"sites":[{"id":74,"x":207,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":75,"x":209,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":76,"x":211,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":77,"x":207,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":78,"x":209,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":79,"x":211,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":387,"x":152,"y":32,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":389,"x":180,"y":118,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":391,"x":208,"y":30,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":393,"x":251,"y":51,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]}]};
function farmFields(data,p) {
  const unlocked=(skill,level)=>p.skills?.[skill]>=Math.round(data.xp.baseXp*(data.xp.growth**(level-1)-1)/(data.xp.growth-1));
  let index=0;
  return data.sites.filter(s=>s.kind==='field').sort((a,b)=>a.id-b.id).filter(site=>{
    const gate=data.farmGates?.[site.id];
    return gate?unlocked(gate.skill,gate.level):unlocked('farming',data.farmUnlocks[index++]??Infinity);
  });
}

function createFarmMemory(data,storage) {
  const key='deepvein-last-plantings-v1';
  return p=>{
    let all={};try{const value=JSON.parse(storage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))all=value;}catch{}
    const last=all[p.id]??{},before=JSON.stringify(last);
    for(const [id,plot]of Object.entries(p.plots??{}))if(Number.isSafeInteger(plot.seedItemId))
      last[id]=plot.seedItemId%data.plusScale%data.rarityScale;
    if(JSON.stringify(last)!==before){all[p.id]=last;try{storage.setItem(key,JSON.stringify(all));}catch{}}
    return last;
  };
}

// Shared policies for both helpers. No combat prediction.
function normalizeFieldBossSettings(value={}) {
  value??={};
  const number=(key,fallback,min,max)=>Number.isFinite(Number(value[key]))?Math.max(min,Math.min(max,Number(value[key]))):fallback;
  const time=(key,fallback,end=false)=>{
    const match=String(value[key]??'').trim().match(/^(\d{1,2})(?::([0-5]\d))?$/);
    if(!match)return fallback;
    const h=Number(match[1]),m=Number(match[2]??0);
    return h<24||end&&h===24&&m===0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:fallback;
  };
  const a=number('delayMin',5,0,1440),b=number('delayMax',10,0,1440);
  return {bossEnabled:value.bossEnabled!==false,farmEnabled:value.farmEnabled!==false,
    bossStart:time('bossStart','08:00'),bossEnd:time('bossEnd','24:00',true),
    skipPercent:number('skipPercent',0,0,100),harvestMode:value.harvestMode==='seed'?'seed':'all',
    delayMin:Math.min(a,b),delayMax:Math.max(a,b),plantMode:value.plantMode==='last'?'last':'game',
    cropJobId:Number.isSafeInteger(value.cropJobId)?value.cropJobId:null};
}

function inBossWindow(settings,time=Date.now()) {
  const minutes=text=>{const [h,m]=text.split(':').map(Number);return h*60+m;};
  const date=new Date(time),current=date.getHours()*60+date.getMinutes(),start=minutes(settings.bossStart),end=minutes(settings.bossEnd);
  return start===end|| (start<end?current>=start&&current<end:current>=start||current<end);
}

function createFieldBossPolicy({now=()=>Date.now(),random=Math.random,saved=null}={}) {
  let decision=saved?.boss??null,pending=saved?.farm??null;
  return {
    boss(key,settings){
      if(!settings.bossEnabled||!inBossWindow(settings,now()))return 'outside';
      if(!decision||decision.key!==key||decision.percent!==settings.skipPercent)
        decision={key,percent:settings.skipPercent,result:settings.skipPercent===0?'join':settings.skipPercent===100||random()*100<settings.skipPercent?'skip':'join'};
      return decision.result;
    },
    farm(key,settings){
      if(!key){pending=null;return null;}
      const config=JSON.stringify([settings.harvestMode,settings.delayMin,settings.delayMax,settings.cropJobId]);
      if(pending?.key!==key||pending.config!==config||!Number.isFinite(pending.dueAt))
        pending={key,config,dueAt:now()+60000*(settings.delayMin+random()*(settings.delayMax-settings.delayMin))};
      return {...pending,ready:now()>=pending.dueAt};
    },
    save:()=>({boss:decision,farm:pending})
  };
}

function farmBatch(data,p,settings,previous={}) {
  const empty={key:null,intent:null,ripe:0,planted:0,reason:'等待作物成熟'};
  if(!p?.skills||!Number.isFinite(p.lastTick))return {...empty,reason:'等待角色状态'};
  const base=id=>id%data.plusScale%data.rarityScale;
  const fields=farmFields(data,p).filter(site=>p.plotChoice?.[site.id]!==0);
  if(!fields.length)return {...empty,reason:'没有启用的农田；已设为“不使用”的田保持停用'};
  const jobs=data.jobs.filter(j=>j.grow),plots=[];
  for(const site of fields){
    const plot=p.plots?.[site.id];if(!plot)continue;
    const job=jobs.find(j=>j.inputs[0].itemId===base(plot.seedItemId));
    if(!job)return {...empty,reason:'未知作物，等待更新游戏数据'};
    const duration=Math.round(job.grow/(plot.sowSpeed??1));
    const trim=plot.trim??Math.min(plot.watered??0,Math.floor(job.grow/2/data.farmWaterTrim))*data.farmWaterTrim;
    plots.push({site,plot,job,ready:plot.plantedAt+duration-Math.min(trim,Math.floor(duration/2))<=p.lastTick});
  }
  const ripe=plots.filter(row=>row.ready),state={...empty,planted:plots.length,ripe:ripe.length};
  const groups=new Map();for(const row of plots){const group=groups.get(row.plot.seedItemId)??[];group.push(row);groups.set(row.plot.seedItemId,group);}
  const qualifies=plots.length>0&&(settings.harvestMode==='seed'?[...groups.values()].some(rows=>rows.every(row=>row.ready)):plots.every(row=>row.ready));
  if(plots.length&&!qualifies)return state;
  const requested=Object.fromEntries(fields.map(site=>[site.id,settings.plantMode==='last'?
    (p.plots?.[site.id]?base(p.plots[site.id].seedItemId):previous[site.id]??p.plotChoice?.[site.id]):
    p.plotChoice?.[site.id]??(p.plots?.[site.id]?base(p.plots[site.id].seedItemId):null)]));
  const legacyJob=jobs.find(j=>j.id===settings.cropJobId);
  if(legacyJob)for(const site of fields)requested[site.id]=legacyJob.inputs[0].itemId;
  const eligible=jobs.filter(job=>p.skills.farming>=Math.round(data.xp.baseXp*(data.xp.growth**(job.levelReq-1)-1)/(data.xp.growth-1)));
  const configured=Object.values(requested).map(seed=>eligible.find(j=>j.inputs[0].itemId===seed)).filter(Boolean);
  const stock=Object.entries(p.bank??{}).concat(Object.entries(p.overflow??{}),(p.pack??[]).map(row=>[row.itemId,row.qty]));
  const job=configured.find(j=>ripe.length||stock.some(([id,qty])=>base(+id)===j.inputs[0].itemId&&qty>0));
  if(configured.length&&!job)return {...state,reason:'缺少所选作物种子；不改种、不购买或采种'};
  if(!job)return {...state,reason:'请在每块田中选择作物；不自动挑选、购买或采集种子'};
  const site=ripe[0]?.site??fields.find(site=>!p.plots?.[site.id]);if(!site)return state;
  // Use the entire planting generation, not the growing subset; maturation of
  // another group during the delay must not restart the clock.
  const key=plots.length?plots.map(row=>`${row.site.id}:${row.plot.seedItemId}:${row.plot.plantedAt}`).join('|'):`empty:${JSON.stringify(requested)}`;
  const choice=fields.find(site=>requested[site.id]!=null&&p.plotChoice?.[site.id]!==requested[site.id]&&
    eligible.some(j=>j.inputs[0].itemId===requested[site.id]&&site.jobIds.includes(j.id)));
  return {...state,key,job,reason:plots.length?'整批已满足收菜条件':'用已有种子补空田',
    intent:choice?{t:'plotChoice',siteId:choice.id,seed:requested[choice.id]}:
      {t:'setRoute',siteId:site.id,jobId:job.id,onFull:'bank',limit:0,errand:true}};
}


// Run after the game's event listener updates its Join control, without relying
// on background-tab timers. Each task releases both ports after delivery.
function deferNativeBoss(fn){
  if(typeof MessageChannel!=='function')return setTimeout(fn,0);
  const channel=new MessageChannel();
  channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();fn();};
  channel.port2.postMessage(null);
}

// Both distributions use the game's Join handler, including its supply, walk,
// attack and restore flow. Never intercept or replace part of that sequence.
function createNativeBoss(data,{document,settings,active,send,prepare,now=()=>Date.now(),defer=deferNativeBoss,label=s=>s}={}) {
  let round=null,run=null,lastClick=-Infinity,goneAt=-Infinity,deathTick=null,participation='full',force=false;
  let dispatching=false,lastResult=null,owner=null;
  let policy=createFieldBossPolicy({now}),message='等待世界 Boss',phase='idle',busy=false,inside=false,restoringUntil=0,completedKey=null;
  const visible=el=>!!el?.isConnected&&!el.hidden&&!el.disabled&&!el.closest('[hidden]')&&el.getClientRects().length>0;
  function controls(){
    const pill=document.querySelector('[data-boss-pill]'),runButton=document.querySelector('[data-boss-run]');
    const text=pill?.querySelector('.boss-pill-join')?.textContent?.trim()??'';
    const joined=visible(pill)&&/^(Show|显示|查看)$/i.test(text)||visible(document.querySelector('[data-boss-leave]'));
    const button=visible(pill)&&/^(Join|加入|加入战斗)$/i.test(text)?pill:
      visible(runButton)&&/^(Run to it|Attack|跑过去|攻击|前往|赶过去)$/i.test(runButton.textContent.trim())?runButton:null;
    const name=(visible(pill)?document.querySelector('[data-boss-pill-name]'):document.querySelector('[data-boss-name]'))?.textContent?.trim()||'世界 Boss';
    return {button,busy:joined,name};
  }
  function leave(){
    if(!run)return;
    restoringUntil=now()+5000;
    const button=document.querySelector('[data-boss-leave]');
    dispatching=true;
    try{if(button)button.click();else send({t:'leaveWorldBoss'});}finally{dispatching=false;}
    run=null;busy=false;
  }
  function observe(frame){
    if(!Array.isArray(frame?.m))return;
    const welcome=frame.m.find(m=>m.t==='welcome');
    if(welcome&&owner!==null&&owner!==welcome.you?.id){round=null;run=null;lastResult=null;completedKey=null;policy=createFieldBossPolicy({now});}
    if(welcome)owner=welcome.you?.id??null;
    if(welcome&&run&&welcome.you?.id!==run.playerId){round=null;run=null;completedKey=null;}
    if(!active()||!settings().bossEnabled||!inBossWindow(settings(),now()))return;
    if(run&&frame.m.some(m=>m.t==='raidDied'||m.t==='batch'&&m.e?.some(e=>e.kind==='died')))deathTick=frame.tick;
    for(const m of frame.m){
      if(m.t==='bossRose'&&typeof m.name==='string'&&Number.isFinite(m.until)){
        const same=round?.until===m.until&&round?.name===m.name;
        const promote=round&&!round.until&&(round.name==='世界 Boss'||label(round.name)===label(m.name));
        if(!same&&!promote){round={key:`${m.name}:${m.until}`,name:m.name};run=null;lastClick=-Infinity;force=false;}
        round.name=m.name;round.until=m.until;round.expiresAt=now()+(m.until-frame.tick)*data.tickMs;round.seenAt=now();
      }
      if(m.t==='raidHit'&&m.damage>0&&run)run.hit=true;
      if(run&&(m.t==='raidDied'||m.t==='batch'&&m.e?.some(e=>e.kind==='died')))deathTick=frame.tick;
      if(m.t==='bossGone'||m.t==='bossHp'&&m.hpRemaining===0){
        if(run&&round)lastResult={name:round.name,hit:run.hit,attackSent:true,endedAt:now(),reason:'本轮结束，由游戏恢复任务'};
        if(run)restoringUntil=now()+5000;
        run=null;round=null;goneAt=now();force=false;phase='ended';
      }
    }
  }
  function next(p){
    const config=settings(),allowed=config.bossEnabled&&inBossWindow(config,now());
    if(!active())return null;
    if(!allowed){leave();inside=false;phase='outside';message=config.bossEnabled?'当前不在参战时段':'世界 Boss 已关闭';return null;}
    if(!inside&&round&&!round.expiresAt&&now()-round.seenAt>10000){round=null;run=null;}
    inside=true;
    const ui=controls();busy=ui.busy;
    if(round?.expiresAt&&now()>=round.expiresAt){round=null;run=null;}
    if(ui.button||ui.busy){if(!round&&now()-goneAt>2000)round={key:`dom:${ui.name}:${now()}`,name:ui.name,seenAt:now()};if(round)round.seenAt=now();}
    else if(round&&!round.expiresAt&&now()-round.seenAt>10000){round=null;run=null;}
    if(run?.hit&&participation==='tag'){completedKey=round?.key;leave();phase='tagged';message='已确认有效伤害，由游戏恢复原任务';}
    else if(busy){phase=run?'fighting':'manual';message=run?.hit?'服务器已确认有效伤害，继续参战':'游戏正在赶路或参战';}
    else if(round){
      const decision=force?'join':policy.boss(round.key,config);
      if(decision==='skip'){phase='skipped';message='本轮按设置的概率跳过';}
      else if(completedKey===round.key){phase='tagged';message='本轮已确认有效伤害，等待下轮';}
      else if(ui.button&&now()-lastClick>=15000){
        const protection=prepare?.(p);
        if(protection?.blocked){phase='skipped';message=protection.reason;return null;}
        if(protection?.intent)return protection;
        lastClick=now();run={key:round.key,hit:false,playerId:p?.id};phase='attacking';message='已请求游戏加入，等待原生赶路／攻击';
        const key=round.key;
        defer(()=>{if(active()&&run?.key===key&&settings().bossEnabled&&inBossWindow(settings(),now())){
          dispatching=true;try{controls().button?.click();}finally{dispatching=false;}
        }});
      }else{phase=run?'attacking':'ready';message=run?'等待游戏响应；加入按钮恢复后会重试':'发现 Boss，等待游戏加入按钮';}
    }else{phase='idle';message='正在等待世界 Boss';}
    return busy||run||now()<restoringUntil?{label:'世界 Boss',reason:message}:null;
  }
  const status=()=>({name:round?.name??null,until:round?.until??null,phase,owned:!!run,visible:!!round,active:inside,
    hit:!!run?.hit,recentActivity:busy,skipped:phase==='skipped',skipReason:message,message,participation,lastResult});
  return {native:true,observe,next,status,ownsRun:()=>!!run,ownsQueue:()=>!!run||busy||now()<restoringUntil,
    ownsDeath:tick=>tick===deathTick,
    handles:intent=>dispatching||!!run&&['joinWorldBoss','attackWorldBoss','raidSupply','walk'].includes(intent.t)||
      now()<restoringUntil&&['startQueued','leaveWorldBoss'].includes(intent.t),
    manualAction:intent=>{if(round&&(run||busy)){
      completedKey=round.key;
      if(intent?.t==='leaveWorldBoss'){run=null;busy=false;restoringUntil=now()+5000;}else leave();
      phase='tagged';message='玩家已接管本轮，继续原任务';
    }},
    issued:()=>{},cancel:()=>{leave();phase='idle';},setParticipation:value=>participation=value==='tag'?'tag':'full',
    retrySkipped:()=>{if(!round)return false;force=true;phase='ready';lastClick=-Infinity;return true;},
    save:()=>({native:1,owner,round,run,lastClick,policy:policy.save(),phase,completedKey,lastResult}),
    restore:saved=>{round=null;run=null;completedKey=null;lastResult=null;policy=createFieldBossPolicy({now});owner=saved?.owner??saved?.run?.playerId??null;phase='idle';lastClick=-Infinity;
      if(saved?.native===1){round=saved.round;run=saved.run;lastClick=saved.lastClick;phase=saved.phase??'idle';completedKey=saved.completedKey??null;lastResult=saved.lastResult??null;policy=createFieldBossPolicy({now,saved:saved.policy});}},
    leave};
}

// The game's plotChoice is authoritative. Editing here is the same explicit
// per-field selection as the native field menu; it never starts an errand.
function createFarmControls(document,container,data,send,label=name=>name) {
  let signature='';
  return p=>{
    if(!p){container.textContent='进入角色后逐田设置作物';return;}
    const unlocked=farmFields(data,p),fields=data.sites.filter(s=>s.kind==='field').sort((a,b)=>a.id-b.id);
    const crops=data.jobs.filter(j=>j.grow),locked=job=>p.skills.farming<Math.round(data.xp.baseXp*(data.xp.growth**(job.levelReq-1)-1)/(data.xp.growth-1));
    const next=JSON.stringify([p.id,unlocked.map(s=>s.id),crops.map(j=>[j.id,j.name,locked(j)]),p.plotChoice]);if(next===signature)return;signature=next;
    container.replaceChildren();
    for(const [index,site]of fields.entries()){
      const row=document.createElement('label'),text=document.createElement('span'),select=document.createElement('select');
      const gate=data.farmGates?.[site.id],name=gate?.name??`农田 ${index+1}`;
      text.textContent=name;select.setAttribute('aria-label',`${name}作物`);select.setAttribute('data-plot-setting',String(site.id));
      select.style.maxWidth='200px';select.style.minWidth='0';
      const option=document.createElement('option');option.value='';option.textContent='游戏默认（任意作物）';select.append(option);
      const disabled=document.createElement('option');disabled.value='0';disabled.textContent='不使用';select.append(disabled);
      for(const job of data.jobs.filter(j=>j.grow&&site.jobIds.includes(j.id))){
        const option=document.createElement('option');option.value=String(job.inputs[0].itemId);
        option.textContent=`${label(job.name)} · ${job.levelReq} 级`;
        option.disabled=locked(job);select.append(option);
      }
      select.value=String(p.plotChoice?.[site.id]??'');select.disabled=!unlocked.some(s=>s.id===site.id);
      if(select.disabled)text.textContent+=`（${gate?`${({woodcutting:'伐木',fishing:'钓鱼',fletching:'箭术',mining:'采矿'})[gate.skill]} ${gate.level}`:'农业等级'}未解锁）`;
      select.onchange=()=>send({t:'plotChoice',siteId:site.id,seed:select.value===''?null:Number(select.value)});
      row.append(text,select);container.append(row);
    }
  };
}

// Same desktop integration points as the comprehensive helper: native toolbar
// and task panel. Keep scheduling independent from opening/closing the UI.
function createFieldBossUi(document,host,root,toggle) {
  let open=false,integrated=false,nav=null,bar=null,state={},scheduled=false,observedRoutes=null;
  const shown=el=>!!el?.isConnected&&!el.hidden&&el.getClientRects().length>0&&
    getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
  const text=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value;};
  const style=document.createElement('style');style.id='dv-field-boss-ui-styles';style.setAttribute('data-no-i18n','');
  style.textContent=`
    .nav-icon.fb-nav{position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:40px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ink,#f5e6c8);cursor:pointer}
    .fb-nav svg{width:24px;height:24px;image-rendering:pixelated;filter:drop-shadow(0 2px 0 #0007)}
    .fb-nav:hover{background:#ffdcaa12}.fb-nav[aria-pressed=true]{background:#e8b25a29;box-shadow:inset 0 0 0 1px #e8b25a8c}
    .fb-nav .nav-badge-dot{position:absolute;top:3px;right:3px;width:9px;height:9px;min-width:9px;border-radius:50%;background:var(--moss,#9ed36b);box-shadow:0 0 0 2px var(--panel,#26180e)}
    .fb-nav[aria-label]::after{content:attr(aria-label);position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);padding:5px 9px;border-radius:5px;white-space:nowrap;background:var(--lg-dark,#26180e);box-shadow:inset 0 0 0 1px #c79352b3,0 4px 10px -4px #0009;font:800 12px/1 var(--font-sans,"Mulish",sans-serif);color:var(--ink,#f5e6c8);opacity:0;pointer-events:none}
    .fb-nav:is(:hover,:focus-visible)::after{opacity:1}
    .fb-bar{position:fixed;z-index:9;display:flex;align-items:center;gap:8px;min-height:34px;box-sizing:border-box;padding:4px 6px 4px 10px;border:1px solid transparent;border-radius:6px;background:var(--lg-dark,#26180e) padding-box,var(--lg-wood,#9a6632) border-box;box-shadow:inset 0 0 0 1px #c79352b3,0 4px 10px -4px #0009;color:var(--ink,#f5e6c8);font:700 12px/1.3 var(--font-sans,"Mulish",sans-serif)}
    .fb-bar [data-fb-bar-open]{display:flex;align-items:center;gap:8px;flex:1;min-width:0;background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .fb-bar-state{flex:none;padding:1px 7px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--edge,#4d3219);color:var(--ink-faint,#ab9270)}
    .fb-bar-state[data-running=true]{color:var(--moss,#9ed36b);box-shadow:inset 0 0 0 1px #9ed36b80}
    .fb-bar-what{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}
    .fb-bar [data-fb-bar-toggle]{flex:none;padding:4px 12px;min-height:26px;border:0;border-radius:6px;background:linear-gradient(180deg,#f5c572,#c98a2c);color:#2a1706;font:800 12px/1.2 var(--font-sans,"Mulish",sans-serif);box-shadow:inset 0 0 0 2px #ffe0a0,0 0 0 2px #4a2a0c,0 3px #4a2a0c;cursor:pointer}
    .fb-bar [data-fb-bar-toggle]:active{transform:translateY(2px)}
    .fb-nav:focus-visible,.fb-bar button:focus-visible{outline:2px solid var(--brass,#e8b25a);outline-offset:3px}
    .fb-bar[hidden],.fb-nav [hidden]{display:none!important}
  `;
  (document.head||document.documentElement).append(style);
  function setOpen(value){
    open=value;sync();
    if(open)root.querySelector('#collapse').focus();else nav?.focus();
  }
  function mountNav(strip){
    if(nav?.parentElement===strip)return;
    nav?.remove();nav=document.createElement('button');nav.type='button';nav.className='nav-icon fb-nav';
    nav.setAttribute('data-fb-nav','');nav.setAttribute('data-no-i18n','');nav.setAttribute('aria-label','世界 Boss 与种菜助手');
    nav.setAttribute('aria-haspopup','dialog');nav.setAttribute('aria-controls',host.id);
    // Reuse the comprehensive helper's pixel-art icon.
    nav.innerHTML=`<svg viewBox="0 0 16 16" width="24" height="24" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2z" fill="#e8b25a"/>
      <rect x="3" y="3" width="10" height="10" rx="1" fill="#9a6632"/><rect x="4" y="4" width="8" height="8" fill="#3b2717"/>
      <rect x="6" y="6" width="4" height="4" fill="#f5c572"/><rect x="7" y="7" width="2" height="2" fill="#231509"/>
      <path d="M7 3h2v2H7zM7 11h2v2H7zM3 7h2v2H3zM11 7h2v2h-2z" fill="#ffd06a"/>
    </svg><b class="nav-badge-dot" hidden></b>`;
    nav.onclick=()=>setOpen(!open);
    const more=strip.querySelector('[data-nav-more]')||strip.querySelector('.nav-more-menu');
    if(more)strip.insertBefore(nav,more);else strip.append(nav);
  }
  function mountBar(){
    if(bar)return;
    bar=document.createElement('div');bar.className='fb-bar';bar.setAttribute('data-fb-bar','');bar.setAttribute('data-no-i18n','');
    bar.innerHTML='<button type="button" data-fb-bar-open aria-label="打开世界 Boss 与种菜助手"><b class="fb-bar-state">已暂停</b><span class="fb-bar-what">世界 Boss＋种菜</span></button><button type="button" data-fb-bar-toggle>开始</button>';
    bar.querySelector('[data-fb-bar-open]').onclick=()=>setOpen(!open);
    bar.querySelector('[data-fb-bar-toggle]').onclick=toggle;document.body.append(bar);
  }
  const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>schedule()):null;
  function sync(){
    const html=document.documentElement,strip=document.querySelector('#app .shell > nav.nav-strip');
    integrated=html.classList.contains('v4')&&!html.classList.contains('m-on')&&shown(strip);
    host.setAttribute('data-theme',html.getAttribute('data-theme')||'dark');
    host.setAttribute('data-integrated',String(integrated));
    if(integrated){
      mountNav(strip);mountBar();host.hidden=!open;host.setAttribute('role','dialog');
      nav.setAttribute('aria-pressed',String(open));nav.querySelector('.nav-badge-dot').hidden=!state.active;
      root.querySelector('#body').hidden=false;
      text(root.querySelector('#collapse'),'×');root.querySelector('#collapse').setAttribute('aria-label','关闭面板');
      const rect=strip.getBoundingClientRect();
      const right=strip.classList.contains('vertical')?Math.max(8,innerWidth-rect.left+12):12;
      const top=!strip.classList.contains('vertical')&&rect.top<innerHeight/2?Math.max(8,rect.bottom+12):null;
      const bottom=strip.classList.contains('vertical')?Math.max(8,innerHeight-rect.bottom):Math.max(8,innerHeight-rect.top+12);
      host.style.right=`${right}px`;host.style.top=top==null?'auto':`${top}px`;host.style.bottom=top==null?`${bottom}px`:'auto';
      host.style.setProperty('--fb-max-height',`${Math.max(80,innerHeight-(top??bottom)-8)}px`);
      host.style.setProperty('--fb-max-width',`${Math.max(180,innerWidth-right-8)}px`);
      const routes=document.querySelector('#app .shell .panels > section.routes')||document.querySelector('#app .shell .routes');
      bar.hidden=!shown(routes)||!!document.querySelector('#app .shell')?.classList.contains('ui-editing');
      if(!bar.hidden){
        const r=routes.getBoundingClientRect();bar.style.left=`${r.left}px`;bar.style.width=`${r.width}px`;
        if(innerHeight-r.bottom<r.top){bar.style.bottom=`${innerHeight-r.top+6}px`;bar.style.top='auto';}
        else{bar.style.top=`${r.bottom+6}px`;bar.style.bottom='auto';}
      }
      if(routes!==observedRoutes){resizeObserver?.disconnect();if(routes)resizeObserver?.observe(routes);observedRoutes=routes;}
      const status=state.active?'运行中':'已暂停';text(bar.querySelector('.fb-bar-state'),status);
      bar.querySelector('.fb-bar-state').setAttribute('data-running',String(!!state.active));
      text(bar.querySelector('.fb-bar-what'),state.active?(state.bossStatus||state.farmStatus||'世界 Boss＋种菜'):(state.status||'世界 Boss＋种菜'));
      text(bar.querySelector('[data-fb-bar-toggle]'),state.active?'暂停':'开始');
    }else{
      nav?.remove();nav=null;if(bar)bar.hidden=true;host.hidden=false;host.removeAttribute('role');
      host.style.right='';host.style.top='';host.style.bottom='';host.style.setProperty('--fb-max-height','calc(100dvh - 75px)');host.style.setProperty('--fb-max-width','calc(100vw - 20px)');
      text(root.querySelector('#collapse'),root.querySelector('#body').hidden?'+':'−');root.querySelector('#collapse').setAttribute('aria-label','展开或收起面板');
    }
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;sync();});}
  root.querySelector('#collapse').onclick=()=>{
    if(integrated)setOpen(false);else{const body=root.querySelector('#body');body.hidden=!body.hidden;sync();}
  };
  const observer=new MutationObserver(schedule);
  observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme']});
  window.addEventListener('resize',schedule);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&integrated&&open)setOpen(false);});
  sync();
  return {update(value){state=value;sync();}};
}

// Display-only names from the public client's static Chinese dictionary.
// Reviewed 2026-10-01: index-DaUDOU_u.js, SHA-256 900dd4f5f503a7792238920e29e06aef67d29a9be0cca44b12b77b6d340f6bde.
// Keep protocol names and numeric IDs unchanged; unknown future names stay visible.
const GAME_LABELS_ZH={
  // Added pets: native Chinese dictionary in index-B8UTkOtA.js (2026-10-03).
  "Pebble golem": "小石魔像",
  "Baby kraken": "小海妖",
  "Acorn squirrel": "橡果松鼠",
  "Queen bee": "蜂后",
  "Raccoon": "浣熊",
  "Chef rat": "厨师鼠",
  "Ember salamander": "余烬蝾螈",
  "Fletch falcon": "箭羽隼",
  "Toadstool": "毒蘑菇人",
  "Yarn kitten": "毛线小猫",
  "Star fairy": "星辰小仙",
  // Compatibility display names reported in the user's current dropdown.
  "Silk-lined hood": "丝衬兜帽",
  "Moon box": "满月礼盒",
  "Linen gloves": "亚麻手套",
  "Abyssal eye": "深渊之眼",
  "Abyssal tonic": "深渊补剂",
  "Ash drake": "灰龙",
  "Ash drake hatchling": "灰龙幼崽",
  "Barrow hound": "冢穴猎犬",
  "Barrow pup": "冢穴幼兽",
  "Bitterroot": "苦根",
  "Bitterroot seed": "苦根种子",
  "Bog pearl": "沼泽珍珠",
  "Bogling": "沼灵",
  "Bogling skin": "沼灵皮",
  "Bogling tadpole": "沼灵蝌蚪",
  "Bogskin chaps": "沼皮护腿",
  "Bogskin coif": "沼皮头巾",
  "Bogskin gloves": "沼皮手套",
  "Bogskin jerkin": "沼皮上衣",
  "Bogskin quiver": "沼皮箭袋",
  "Bone gloves": "骨手套",
  "Bread stall": "面包摊",
  "Bronze axe": "青铜斧",
  "Bronze bar": "青铜锭",
  "Bronze blade": "青铜剑",
  "Bronze greatsword": "青铜大剑",
  "Bronze greaves": "青铜护腿",
  "Bronze hammer": "青铜锤",
  "Bronze helm": "青铜头盔",
  "Bronze hoe": "青铜锄",
  "Bronze knife": "青铜刀",
  "Bronze mortar": "青铜研钵",
  "Bronze needle": "青铜针",
  "Bronze pan": "青铜平底锅",
  "Bronze pickaxe": "青铜镐",
  "Bronze plate": "青铜铠甲",
  "Bronze rod": "青铜钓竿",
  "Bronze shield": "青铜盾",
  "Burnt food": "烧焦的食物",
  "Cairn bone": "石冢骨",
  "Cairn token": "石冢徽记",
  "Cairn wight": "石冢尸灵",
  "Cairn wisp": "石冢幽光",
  "Cave turnip": "洞穴芜菁",
  "Chalk wight": "白垩尸灵",
  "Chalk wightling": "白垩尸灵",
  "Chest of gems": "宝石箱",
  "Chitin chaps": "甲壳护腿",
  "Chitin coif": "甲壳头巾",
  "Chitin gloves": "甲壳手套",
  "Chitin jerkin": "甲壳上衣",
  "Chitin quiver": "甲壳箭袋",
  "Cinder colossus": "灰烬巨像",
  "Cinder ember": "灰烬余火",
  "Coal": "煤炭",
  "Cobalt": "钴蓝",
  "Cobalt axe": "钴斧",
  "Cobalt bar": "钴锭",
  "Cobalt blade": "钴剑",
  "Cobalt greatsword": "钴大剑",
  "Cobalt greaves": "钴护腿",
  "Cobalt hammer": "钴锤",
  "Cobalt helm": "钴头盔",
  "Cobalt hoe": "钴锄",
  "Cobalt knife": "钴刀",
  "Cobalt mortar": "钴研钵",
  "Cobalt needle": "钴针",
  "Cobalt pan": "钴平底锅",
  "Cobalt pickaxe": "钴镐",
  "Cobalt plate": "钴铠甲",
  "Cobalt rod": "钴钓竿",
  "Cobalt shield": "钴盾",
  "Coins": "金币",
  "Colossus blade": "巨像之剑",
  "Colossus chip": "巨像碎片",
  "Colossus core": "巨像核心",
  "Colossus ember": "巨像余烬",
  "Colossus greatsword": "巨像大剑",
  "Colossus greaves": "巨像护腿",
  "Colossus helm": "巨像头盔",
  "Colossus plate": "巨像铠甲",
  "Colossus shield": "巨像之盾",
  "Cook lobster": "烹饪龙虾",
  "Cook salmon": "烹饪三文鱼",
  "Cook sardine": "烹饪沙丁鱼",
  "Cook shark": "烹饪鲨鱼",
  "Cook shrimp": "烹饪虾",
  "Cook swordfish": "烹饪剑鱼",
  "Cook trout": "烹饪鳟鱼",
  "Cook tuna": "烹饪金枪鱼",
  "Cooked lobster": "熟龙虾",
  "Cooked salmon": "熟三文鱼",
  "Cooked sardine": "熟沙丁鱼",
  "Cooked shark": "熟鲨鱼",
  "Cooked shrimp": "熟虾",
  "Cooked swordfish": "熟剑鱼",
  "Cooked trout": "熟鳟鱼",
  "Cooked tuna": "熟金枪鱼",
  "Copper": "铜矿",
  "Cut gem": "切割宝石",
  "Deep horror": "深渊恐魔",
  "Dragonleaf": "龙叶",
  "Dragonleaf seed": "龙叶种子",
  "Drake chaps": "幼龙护腿",
  "Drake coif": "幼龙头巾",
  "Drake hide": "幼龙皮",
  "Drake jerkin": "幼龙上衣",
  "Drake quiver": "幼龙箭袋",
  "Drake scale": "幼龙鳞",
  "Dry sigil": "干枯符印",
  "Dune stalker": "沙丘潜袭者",
  "Elixir of the vein": "矿脉灵药",
  "Ember Wyrm": "余烬飞龙",
  "Ember heart": "余烬之心",
  "Ember pepper": "余烬辣椒",
  "Ember scale": "余烬之鳞",
  "Emberkin": "余烬灵",
  "Emberkin spark": "余烬灵火花",
  "Epic": "史诗",
  "Fen lurker": "沼潜者",
  "Fen lurker spawn": "沼潜者幼体",
  "Frost Leviathan": "霜冻利维坦",
  "Frost troll": "霜巨魔",
  "Frost troll whelp": "霜巨魔幼崽",
  "Fur chaps": "毛皮护腿",
  "Fur coif": "毛皮头巾",
  "Fur jerkin": "毛皮上衣",
  "Fur quiver": "毛皮箭袋",
  "Gatherer's draught": "采集者药剂",
  "Gem pack": "宝石包",
  "Gem stall": "宝石摊",
  "Gilded bolt": "镀金布匹",
  "Gilded grimoire": "镀金魔典",
  "Gilded hood": "镀金兜帽",
  "Gilded loom": "镀金织机",
  "Gilded robe": "镀金长袍",
  "Gilded skirt": "镀金裙",
  "Glowcap": "荧光菇",
  "Glowcap spore": "荧光菇孢子",
  "Gnawed charm": "啃噬护符",
  "Gnawer": "啃噬者",
  "Gnawer pelt": "啃噬者毛皮",
  "Gnawer pup": "啃噬者幼崽",
  "Gold": "金币",
  "Gold amulet": "黄金护符",
  "Gold ring": "黄金戒指",
  "Golden Week gift box": "金秋礼盒",
  "Grave beetle": "墓甲虫",
  "Grave beetle grub": "墓甲虫幼虫",
  "Gravemaw skull": "墓噬者头骨",
  "Haste draught": "急速药剂",
  "Hoard of gems": "宝石堆",
  "Hollow crown": "空心王冠",
  "Homespun bolt": "粗布匹",
  "Homespun hood": "粗布兜帽",
  "Homespun robe": "粗布长袍",
  "Homespun skirt": "粗布裙",
  "Horror ichor": "恐魔脓液",
  "Horror spawn": "恐魔幼体",
  "Horse": "坐骑",
  "Hunter's brew": "猎人酿剂",
  "Husk": "空壳",
  "Husk chitin": "空壳甲壳",
  "Husk grub": "空壳幼虫",
  "Ice wight": "冰尸",
  "Ice wight shard": "冰尸碎片",
  "Ice wight shard-child": "冰尸幼体",
  "Iron": "铁矿",
  "Iron axe": "铁斧",
  "Iron bar": "铁锭",
  "Iron blade": "铁剑",
  "Iron greatsword": "铁大剑",
  "Iron greaves": "铁护腿",
  "Iron hammer": "铁锤",
  "Iron helm": "铁头盔",
  "Iron hoe": "铁锄",
  "Iron knife": "铁刀",
  "Iron mortar": "铁研钵",
  "Iron needle": "铁针",
  "Iron pan": "铁平底锅",
  "Iron pickaxe": "铁镐",
  "Iron plate": "铁铠甲",
  "Iron rod": "铁钓竿",
  "Iron shield": "铁盾",
  "Legendary": "传说",
  "Leviathan amulet": "利维坦护符",
  "Leviathan scale": "利维坦之鳞",
  "Linen grimoire": "亚麻魔典",
  "Linen line": "亚麻织线",
  "Lobster": "龙虾",
  "Logs": "原木",
  "Longbow": "长弓",
  "Magic": "魔法",
  "Magic logs": "魔法原木",
  "Magic longbow": "魔法长弓",
  "Magic shortbow": "魔法短弓",
  "Magic staff": "魔法法杖",
  "Maple": "枫木",
  "Maple logs": "枫木",
  "Maple longbow": "枫木长弓",
  "Maple shortbow": "枫木短弓",
  "Maple staff": "枫木法杖",
  "Meteoric": "陨铁矿",
  "Meteoric amulet": "陨铁护符",
  "Meteoric axe": "陨铁斧",
  "Meteoric bar": "陨铁锭",
  "Meteoric blade": "陨铁剑",
  "Meteoric greatsword": "陨铁大剑",
  "Meteoric greaves": "陨铁护腿",
  "Meteoric hammer": "陨铁锤",
  "Meteoric helm": "陨铁头盔",
  "Meteoric hoe": "陨铁锄",
  "Meteoric knife": "陨铁刀",
  "Meteoric mortar": "陨铁研钵",
  "Meteoric needle": "陨铁针",
  "Meteoric pan": "陨铁平底锅",
  "Meteoric pickaxe": "陨铁镐",
  "Meteoric plate": "陨铁铠甲",
  "Meteoric ring": "陨铁戒指",
  "Meteoric rod": "陨铁钓竿",
  "Meteoric shield": "陨铁盾",
  "Nightshade": "颠茄",
  "Nightshade seed": "颠茄种子",
  "Nourishing draught": "滋养药剂",
  "Oak": "橡木",
  "Oak logs": "橡木",
  "Oak longbow": "橡木长弓",
  "Oak shortbow": "橡木短弓",
  "Oak staff": "橡木法杖",
  "Pelt chaps": "兽皮护腿",
  "Pelt coif": "兽皮头巾",
  "Pelt gloves": "兽皮手套",
  "Pelt jerkin": "兽皮上衣",
  "Pelt quiver": "兽皮箭袋",
  "Pepper seed": "辣椒种子",
  "Potato": "土豆",
  "Potato seed": "土豆种子",
  "Pouch of gems": "宝石袋",
  "Protection scroll": "保护卷轴",
  "Rare": "稀有",
  "Relic stall": "遗物摊",
  "Reliquary vestry": "圣物储藏室",
  "Riftborne heart": "裂生之心",
  "Rime fang": "寒霜之牙",
  "Rimewolf": "霜狼",
  "Rimewolf cub": "霜狼幼崽",
  "Rimewolf fur": "霜狼毛皮",
  "Rock mite": "岩螨",
  "Rock mite nymph": "岩螨若虫",
  "Rough gem": "粗糙宝石",
  "Sage": "鼠尾草",
  "Sage seed": "鼠尾草种子",
  "Salmon": "三文鱼",
  "Sand wraith": "沙之怨灵",
  "Sardine": "沙丁鱼",
  "Scale chaps": "鳞片护腿",
  "Scale coif": "鳞片头巾",
  "Scale gloves": "鳞片手套",
  "Scale jerkin": "鳞片上衣",
  "Scale quiver": "鳞片箭袋",
  "Shark": "鲨鱼",
  "Shortbow": "短弓",
  "Shrimp": "虾",
  "Silk bolt": "丝绸布匹",
  "Silk cart": "丝绸车",
  "Silk grimoire": "丝绸魔典",
  "Silk hood": "丝绸兜帽",
  "Silk robe": "丝绸长袍",
  "Silk skirt": "丝绸裙",
  "Silk stall": "丝绸摊",
  "Silver": "银矿",
  "Silver amulet": "白银护符",
  "Silver ring": "白银戒指",
  "Staff": "法杖",
  "Stalker claw": "潜袭者之爪",
  "Stalker fang": "潜袭者之牙",
  "Stalker kit": "潜袭者幼崽",
  "Steel axe": "钢斧",
  "Steel bar": "钢锭",
  "Steel blade": "钢剑",
  "Steel greatsword": "钢大剑",
  "Steel greaves": "钢护腿",
  "Steel hammer": "钢锤",
  "Steel helm": "钢头盔",
  "Steel hoe": "钢锄",
  "Steel knife": "钢刀",
  "Steel mortar": "钢研钵",
  "Steel needle": "钢针",
  "Steel pan": "钢平底锅",
  "Steel pickaxe": "钢镐",
  "Steel plate": "钢铠甲",
  "Steel rod": "钢钓竿",
  "Steel shield": "钢盾",
  "Stone eater": "食石者",
  "Stone eater pebble": "食石者卵石",
  "Sump crawler": "污水爬行者",
  "Sump crawler hatchling": "污水爬行者幼体",
  "Swift draught": "疾行药剂",
  "Swordfish": "剑鱼",
  "Tin": "锡矿",
  "Tree": "树",
  "Troll chaps": "巨魔护腿",
  "Troll coif": "巨魔头巾",
  "Troll hide": "巨魔皮",
  "Troll jerkin": "巨魔上衣",
  "Troll quiver": "巨魔箭袋",
  "Troll tusk": "巨魔獠牙",
  "Trout": "鳟鱼",
  "Tuna": "金枪鱼",
  "Turnip seed": "芜菁种子",
  "Uncommon": "罕见",
  "Vein Colossus": "矿脉巨像",
  "Vein of gems": "宝石矿脉",
  "Voidmelon": "虚空瓜",
  "Voidmelon seed": "虚空瓜种子",
  "Voidshard": "虚空碎片",
  "Voidweave bolt": "虚织布匹",
  "Voidweave grimoire": "虚织魔典",
  "Voidweave hood": "虚织兜帽",
  "Voidweave robe": "虚织长袍",
  "Voidweave skirt": "虚织裙",
  "Warrior's tonic": "战士补剂",
  "Wight crown": "尸灵王冠",
  "Wightweave grimoire": "尸织魔典",
  "Wightweave hood": "尸织兜帽",
  "Wightweave robe": "尸织长袍",
  "Wightweave skirt": "尸织裙",
  "Willow": "柳木",
  "Willow logs": "柳木",
  "Willow longbow": "柳木长弓",
  "Willow shortbow": "柳木短弓",
  "Willow staff": "柳木法杖",
  "Wraith ash": "怨灵之烬",
  "Wraith dust": "怨灵之尘",
  "Wraith mote": "怨灵微粒",
  "Wyrm ember": "巨龙余烬",
  "Wyrm ring": "巨龙戒指",
  "Yew": "紫杉木",
  "Yew logs": "紫杉木",
  "Yew longbow": "紫杉长弓",
  "Yew shortbow": "紫杉短弓",
  "Yew staff": "紫杉法杖"
};

function gameLabel(name) {
  const text=String(name??'');
  return Object.hasOwn(GAME_LABELS_ZH,text)?GAME_LABELS_ZH[text]:text;
}

const GAME_LABEL_PATTERN=new RegExp('(^|[^A-Za-z0-9_])('+Object.keys(GAME_LABELS_ZH)
  .sort((a,b)=>b.length-a.length)
  .map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?=$|[^A-Za-z0-9_])','g');

function translateGameText(text) {
  return String(text??'').replace(GAME_LABEL_PATTERN,(_,prefix,name)=>prefix+gameLabel(name));
}

// Personal settlement evidence: research/boss-rewards-mechanics.md.
// Original chat ticks survive welcome-history replay and are not frame ticks.
const BOSS_LOOT_RECEIPT=/^Your share of the (.+): (.+?)(?: — on|\. On) your shelf at the depot\.$/;

function createBossLootHistory(data,storage,now=()=>Date.now()) {
  let playerId=null,entries=[],saved=true,lastFrame=null,migratedFrom=null;
  const storageKey=()=>`deepvein-boss-loot-v1:${playerId}`;
  function receipt(message,time) {
    if(!message||!['Deep Vein','The Deep'].includes(message.name)||
      typeof message.text!=='string'||message.text.length>4000||
      !Number.isSafeInteger(message.tick)||message.tick<0)return null;
    const match=BOSS_LOOT_RECEIPT.exec(message.text);
    if(!match)return null;
    // Both native wordings use the original storage key when history replays.
    return {key:`${message.tick}:Your share of the ${match[1]}: ${match[2]} — on your shelf at the depot.`,tick:message.tick,
      time:Number.isFinite(time)&&Math.abs(time)<=8640000000000000?time:null,boss:match[1],reward:match[2]};
  }
  function newest(rows) {
    const unique=new Map();
    for(const row of rows)if(!unique.has(row.key)||unique.get(row.key).time===null)unique.set(row.key,row);
    return [...unique.values()].sort((a,b)=>b.tick-a.tick||a.key.localeCompare(b.key)).slice(0,100);
  }
  function read(timeAt) {
    try {
      const value=JSON.parse(storage.getItem(storageKey())??'null');
      if(![1,2].includes(value?.v)||!Array.isArray(value.entries))return [];
      const calibrated=value.v===2&&value.timeRevision===3;
      if(!calibrated){saved=false;migratedFrom=value.v;}
      return value.entries.slice(0,100).map(row=>receipt({name:'The Deep',tick:row?.tick,
        text:typeof row?.boss==='string'&&typeof row?.reward==='string'?
          `Your share of the ${row.boss}: ${row.reward} — on your shelf at the depot.`:null},
        calibrated?row?.time:timeAt(row?.tick))).filter(Boolean);
    }catch {saved=false;return [];}
  }
  function observe(frame) {
    if(!Array.isArray(frame?.m))return;
    const receivedAt=now(),timeAt=messageTick=>{
      const time=Number.isSafeInteger(frame.tick)&&frame.tick>=0?
        receivedAt-(frame.tick-messageTick)*data.tickMs:null;
      return Number.isFinite(time)&&Math.abs(time)<=8640000000000000?time:null;
    };
    if(Number.isSafeInteger(frame.tick)&&frame.tick>=0)lastFrame={tick:frame.tick,receivedAt};
    const welcome=frame.m.find(m=>m?.t==='welcome');
    if(welcome) {
      const id=welcome.you?.id;
      if(!Number.isSafeInteger(id)||id<0){connectionOpened();return;}
      if(id!==playerId){playerId=id;saved=true;entries=[];migratedFrom=null;}
    }
    if(playerId===null)return;
    const messages=[...(Array.isArray(welcome?.chat)?welcome.chat:[]),...frame.m.filter(m=>m?.t==='chat')];
    const incoming=messages.map(message=>receipt(message,timeAt(message?.tick))).filter(Boolean);
    if(!welcome&&!incoming.length&&!entries.some(row=>row.time===null))return;
    const merged=newest([...entries,...read(timeAt),...incoming])
      .map(row=>row.time===null?{...row,time:timeAt(row.tick)}:row);
    if(saved&&JSON.stringify(merged)===JSON.stringify(entries))return;
    entries=merged;
    try {storage.setItem(storageKey(),JSON.stringify({v:2,timeRevision:3,entries}));saved=true;}
    catch {saved=false;}
  }
  function connectionOpened(){playerId=null;entries=[];saved=true;lastFrame=null;migratedFrom=null;}
  return {observe,connectionOpened,status:()=>({playerId,entries,saved}),
    diagnostics:()=>({playerId,schema:2,timeRevision:3,migratedFrom,tickMs:data.tickMs,lastFrame,
      entries:entries.map(row=>({...row,currentEstimate:lastFrame?
        lastFrame.receivedAt-(lastFrame.tick-row.tick)*data.tickMs:null}))})};
}

function createBossLootChat(document,history,translateGameText=text=>text) {
  let mounted=null,style=null,disposed=false;
  const css=`
    .chat[data-dv-loot-open]>.chat-body>[data-log]{position:absolute;visibility:hidden;pointer-events:none}
    .chat[data-dv-loot-open]>.chat-body>[data-dm-people],
    .chat[data-dv-loot-open]>.chat-body>[data-compose],
    .chat[data-dv-loot-open]>.chat-body>[data-chat-guest]{display:none!important}
    .chat .dv-boss-loot[hidden]{display:none!important}
    .chat .dv-boss-loot{box-sizing:border-box;min-height:80px;gap:10px}
    .chat .dv-loot-note{color:var(--ink-faint);font-size:.9em;line-height:1.5}
    .chat .dv-loot-entry{padding:0 0 9px;border-bottom:1px solid var(--edge);overflow-wrap:anywhere}
    .chat .dv-loot-entry:last-child{border-bottom:0}
    .chat .dv-loot-title{display:flex;flex-wrap:wrap;gap:3px 10px;align-items:baseline;margin-bottom:3px}
    .chat .dv-loot-boss{color:var(--brass);font-weight:700}
    .chat .dv-loot-time{color:var(--ink-faint);font-size:.85em;font-variant-numeric:tabular-nums}
    .chat .dv-loot-reward{color:var(--ink);line-height:1.5}
    .m-on .chat .dv-boss-loot{height:auto!important;min-height:0;flex:1 1 auto}
    .m-on .chat[data-dv-loot-open]>.chat-body>[data-log]{display:none!important}
  `;
  const element=(tag,className,text)=>{
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const leave=(restoreScroll=true)=>{
    const m=mounted;if(!m?.active)return;
    m.active=false;m.panel.hidden=true;m.chat.removeAttribute('data-dv-loot-open');
    m.tab.setAttribute('aria-selected','false');
    for(const tab of m.tabs.querySelectorAll('[data-room]'))tab.setAttribute('aria-selected',String(tab.dataset.room===m.chat.dataset.room));
    if(restoreScroll&&m.chat.dataset.room===m.room)m.log.scrollTop=m.scroll;
  };
  const unmount=()=>{
    if(!mounted)return;
    leave();mounted.tabs.removeEventListener('click',mounted.onRoom);
    mounted.tab.remove();mounted.panel.remove();mounted=null;
  };
  function render() {
    const m=mounted;if(!m)return;
    const state=history.status(),signature=JSON.stringify(state);
    if(signature===m.signature)return;
    m.signature=signature;
    const scroll=m.panel.scrollTop;
    m.panel.replaceChildren();
    const note=state.playerId==null?'进入角色后开始记录自己的世界 Boss 掉落。':
      state.saved?'最近 100 条 · 仅保存本角色的掉落，记录保存在当前浏览器。':
        '浏览器暂时无法保存，刷新后本次记录可能丢失。';
    m.panel.append(element('div','dv-loot-note',note));
    const entries=state.entries??[];
    if(!entries.length)m.panel.append(element('div','dv-loot-note','暂无掉落记录；收到服务器的 Boss 奖励后会显示在这里。'));
    for(const entry of entries){
      const row=element('article','dv-loot-entry'),title=element('div','dv-loot-title');
      const time=Number.isFinite(entry.time)&&entry.time>0?new Date(entry.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'时间未知';
      title.append(element('strong','dv-loot-boss',translateGameText(entry.boss)),element('time','dv-loot-time',time));
      row.append(title,element('div','dv-loot-reward',translateGameText(entry.reward).replace(/\b(?:coins|gold)\b/gi,'金币').replace(/\bvoid ?shards\b/gi,'虚空碎片')));
      m.panel.append(row);
    }
    m.panel.scrollTop=scroll;
  }
  function refresh() {
    if(disposed||!document?.querySelector)return;
    const chat=document.querySelector('.chat'),body=chat?.querySelector('.chat-body'),tabs=body?.querySelector('.chat-tabs'),log=body?.querySelector('[data-log]');
    if(!chat||!body||!tabs||!log){unmount();return;}
    if(mounted?.chat!==chat||mounted.tabs!==tabs||!mounted.tab.isConnected||!mounted.panel.isConnected){
      unmount();
      chat.removeAttribute('data-dv-loot-open');
      for(const leftover of chat.querySelectorAll('[data-dv-boss-loot-tab],[data-dv-boss-loot-panel]'))leftover.remove();
      for(const nativeTab of tabs.querySelectorAll('[data-room]'))nativeTab.setAttribute('aria-selected',String(nativeTab.dataset.room===chat.dataset.room));
      if(!style){style=element('style');style.textContent=css;(document.head??document.body).append(style);}
      const tab=element('button','chat-tab','Boss 掉落'),panel=element('section','chat-log dv-boss-loot');
      tab.type='button';tab.dataset.dvBossLootTab='';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');
      panel.dataset.dvBossLootPanel='';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-label','世界 Boss 掉落记录');panel.hidden=true;
      mounted={chat,body,tabs,log,tab,panel,active:false,room:null,scroll:0,height:260,signature:null,onRoom:null};
      const m=mounted;
      m.onRoom=event=>{
        const room=event.target.closest?.('[data-room]');
        if(!m.active||!room||!tabs.contains(room))return;
        const restore=room.dataset.room===m.room,scroll=m.scroll;
        leave(false);
        if(restore&&m.chat.dataset.room===m.room)m.log.scrollTop=scroll;
      };
      tabs.addEventListener('click',m.onRoom);
      tab.addEventListener('click',()=>{
        if(mounted!==m||m.active)return;
        m.scroll=log.scrollTop;m.room=chat.dataset.room;m.height=log.offsetHeight||parseFloat(log.style.height)||260;
        m.active=true;chat.setAttribute('data-dv-loot-open','');panel.hidden=false;
        panel.style.height=log.style.height||`${m.height}px`;
        for(const nativeTab of tabs.querySelectorAll('[data-room]'))nativeTab.setAttribute('aria-selected','false');
        tab.setAttribute('aria-selected','true');render();
      });
      tabs.append(tab);body.insertBefore(panel,log);
    }
    const m=mounted;
    if(m.active){
      if(m.chat.dataset.room!==m.room||m.tabs.querySelector('[data-room][aria-selected="true"]'))leave(false);
      else m.panel.style.height=m.log.style.height||`${m.height}px`;
    }
    render();
  }
  function destroy(){disposed=true;unmount();style?.remove();style=null;}
  return {refresh,destroy};
}

(function fieldBossBrowser(){
  if(window.__deepveinFieldBoss)return;
  window.__deepveinFieldBoss=true;
  const key='deepvein-field-boss-v1',leaseKey='deepvein-balanced-trainer-lease';
  const owner=crypto.randomUUID(),NativeSocket=window.WebSocket;
  const read=(store,name)=>{try{return JSON.parse(store.getItem(name)||'null');}catch{return null;}};
  let settings=normalizeFieldBossSettings(read(localStorage,key)),active=false,socket=null,player=null,compatible=false;
  let received=0,frameTick=0,lastSync=-Infinity;
  let policy=createFieldBossPolicy(),pendingFarm=null,root=null,ui=null,status='已暂停',bossStatus='等待开始',farmStatus='等待开始';
  let savedText='';
  let fieldControls=null;
  const rememberPlots=createFarmMemory(GAME_DATA,localStorage);
  const history=createBossLootHistory(GAME_DATA,localStorage),chat=createBossLootChat(document,history,translateGameText);
  const runtimeKey=()=>`${key}:${player?.id}`;
  function save(){
    if(!player)return;
    const value=JSON.stringify({active,boss:boss.save(),policy:policy.save()});
    if(value!==savedText){sessionStorage.setItem(runtimeKey(),value);savedText=value;}
  }
  function lease(){
    const old=read(localStorage,leaseKey);
    if(old&&old.owner!==owner&&old.until>Date.now())return false;
    localStorage.setItem(leaseKey,JSON.stringify({owner,until:Date.now()+20000}));
    return read(localStorage,leaseKey)?.owner===owner;
  }
  function release(){if(read(localStorage,leaseKey)?.owner===owner)localStorage.removeItem(leaseKey);}
  const connected=()=>socket?.readyState===NativeSocket.OPEN&&player&&compatible;
  const send=intent=>{if(connected())NativeSocket.prototype.send.call(socket,JSON.stringify(intent));};
  const boss=createNativeBoss(GAME_DATA,{document,settings:()=>settings,active:()=>active,send,label:translateGameText,defer:fn=>fn()});
  const stopOwnBoss=()=>boss.leave();
  function pump(){
    if(!root)mount();
    chat.refresh();
    if(!active){render();return;}
    if(!connected()){status='等待游戏连接';render();return;}
    if(!lease()){active=false;status='另一份助手正在运行，请先暂停它';save();render();return;}
    const now=Date.now();
    const waiting=boss.next(player);bossStatus=boss.status().message;
    if(waiting){status='运行中';save();render();sync(now);return;}
    if(!settings.farmEnabled){farmStatus='种菜已关闭';policy.farm(null,settings);}
    else if(now-received>45000)farmStatus='等待最新农田状态';
    else{
      const p={...player,lastTick:Math.max(player.lastTick??0,frameTick)};
      const batch=farmBatch(GAME_DATA,p,settings,rememberPlots(p));
      const scheduled=policy.farm(batch.key,settings);
      farmStatus=`${batch.ripe}/${batch.planted} 块成熟 · ${batch.reason}`;
      const busy=p.held||p.raidHeld||p.route?.errand||p.enhance||!p.route&&(p.path?.length||p.activity==='walking');
      if(pendingFarm&&received>pendingFarm.sentAt){
        if(p.route?.errand||batch.key!==pendingFarm.key||JSON.stringify(batch.intent)!==pendingFarm.intent)pendingFarm=null;
        else if(now-pendingFarm.sentAt>30000)pendingFarm=null;
      }
      if(p.route?.errand)farmStatus='游戏正在整批收获补种，完成后恢复原任务';
      else if(scheduled&&!scheduled.ready&&batch.planted)farmStatus+=` · 约 ${Math.ceil((scheduled.dueAt-now)/60000)} 分钟后出发`;
      else if(scheduled&&(!batch.planted||scheduled.ready)&&!busy&&!pendingFarm){
        send(batch.intent);pendingFarm={key:batch.key,sentAt:now,intent:JSON.stringify(batch.intent)};
        farmStatus=batch.intent.t==='plotChoice'?'正在应用逐田补种选择':'已发起原生整批收获补种';
      }
    }
    status='运行中';save();render();sync(now);
  }
  function sync(now){if(now-lastSync>=15000){lastSync=now;send({t:'resync'});}}
  window.WebSocket=class extends NativeSocket{
    constructor(...args){
      super(...args);
      const url=new URL(String(args[0]),location.href);if(url.host!==location.host||url.pathname!=='/ws')return;
      socket=this;compatible=false;history.connectionOpened();
      this.addEventListener('message',event=>{
        if(socket!==this||typeof event.data!=='string')return;
        try{
          const frame=JSON.parse(event.data);if(!Array.isArray(frame.m))return;
          history.observe(frame);
          const welcome=frame.m.find(m=>m.t==='welcome');let changed=!!welcome;
          if(welcome){
            const changed=player?.id!==welcome.you?.id;player=welcome.you;compatible=welcome.protocol===GAME_DATA.protocol;
            if(changed){
              const saved=read(sessionStorage,runtimeKey());active=saved?.active===true;
              policy=createFieldBossPolicy({saved:saved?.policy});boss.restore(saved?.boss);pendingFarm=null;savedText='';
            }
            if(!compatible){active=false;status='游戏协议已变化，已暂停';}
            frameTick=frame.tick;received=Date.now();
          }
          for(const m of frame.m){
            if(m.t==='snapshot'&&player&&m.you?.id===player.id&&frame.tick>=frameTick){player=m.you;frameTick=frame.tick;received=Date.now();changed=true;}
          }
          if(player)rememberPlots(player);
          boss.observe(frame);
          if(frame.m.some(m=>['bossRose','bossGone','bossHp','raidHit'].includes(m.t)))changed=true;
          // Native listeners must update their state and button labels first.
          if(changed)deferNativeBoss(pump);
        }catch(error){active=false;status=`已暂停：${error.message}`;release();render();}
      });
      this.addEventListener('close',event=>{if(socket===this){compatible=false;if(event.code===4001||event.code===4002)active=false;save();release();}});
    }
  };
  function mount(){
    if(root||!document.body)return;
    const host=document.createElement('div');host.id='dv-field-boss';host.setAttribute('aria-label','世界 Boss 与种菜助手');host.setAttribute('data-no-i18n','');document.body.append(host);root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>
      :host{position:fixed;right:12px;top:60px;z-index:10;color:var(--ink,#f5e6c8);font:13px/1.5 var(--font-sans,"Mulish",ui-sans-serif,system-ui,sans-serif);width:min(340px,var(--fb-max-width,calc(100vw - 24px)));color-scheme:dark}
      :host([hidden]){display:none!important}:host([data-theme=light]){color-scheme:light;--panel:#f3e6c8;--panel-sunken:#e2cfa4;--edge:#b89763;--ink:#3d2612;--ink-faint:#876640;--brass:#9a6212;--brass-bright:#b87a1e;--lg-dark:radial-gradient(ellipse 120% 90% at 50% 35%,#f8ecd2 0%,#ecdab3 60%,#dcc394 100%)}
      *{box-sizing:border-box}section{display:flex;flex-direction:column;background:var(--lg-dark,radial-gradient(ellipse 120% 80% at 50% 0%,#3b2717 0%,#25170d 65%,#1d1209 100%)) padding-box,var(--lg-wood,linear-gradient(135deg,#9a6632,#6e411d 28%,#a26d37 52%,#5f3616 78%,#83502a)) border-box;border:1px solid transparent;border-radius:8px;box-shadow:inset 0 0 0 1px #c79352b3,0 0 0 1px #1f1108,0 9px 22px -6px #0009;max-height:var(--fb-max-height,calc(100dvh - 76px));overflow:hidden}
      header{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:12px 16px 10px;border-bottom:2px solid #0005;box-shadow:0 1px #ffdcaa14}strong{font-size:20px;line-height:1.1;flex:1}small,.note{color:var(--ink-faint,#ab9270)}button,input,select{font:inherit;color:inherit;background:var(--panel-sunken,#170e07);border:1px solid var(--edge,#4d3219);border-radius:4px;padding:5px 8px}
      #body{padding:0 14px 14px;overflow:auto;min-height:0}#status{padding:10px 14px 0;flex-shrink:0}button{cursor:pointer}button:hover{border-color:var(--brass-bright,#f5c572)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--brass,#e8b25a);outline-offset:2px}#toggle{background:linear-gradient(180deg,#f5c572,#c98a2c);color:#2a1706;font-weight:800;width:100%;margin:10px 0;border:0;box-shadow:inset 0 0 0 2px #ffe0a0,0 0 0 2px #4a2a0c,0 3px #4a2a0c}#collapse{width:28px;height:28px;flex-shrink:0;border:0;border-radius:50%;background:linear-gradient(180deg,#a86d34,#6e3f18);color:#fff3dc;box-shadow:inset 0 0 0 2px #d9a560,0 0 0 2px #3b2210;font-size:18px;line-height:1;padding:0}h3{font-size:14px;margin:14px 0 8px;border-top:1px solid var(--edge,#4d3219);padding-top:12px}
      label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;flex-wrap:wrap}input[type=number]{width:75px}input[type=text]{width:76px}input[type=checkbox]{accent-color:#d9a552}select{width:100%;min-width:0}.row{display:flex;align-items:center;gap:7px}.note{font-size:12px;margin:7px 0;overflow-wrap:anywhere}a{color:var(--brass,#e8b25a)}#body[hidden]{display:none}
      @media(max-width:480px){:host{right:10px;top:55px}button{min-height:32px}} 
    </style><section><header><strong>世界 Boss＋种菜</strong><small>v${SCRIPT_VERSION}</small><button id="collapse" aria-label="折叠面板">−</button></header>
    <div id="status" role="status">已暂停</div><div id="body"><button id="toggle">开始</button>
    <h3>世界 Boss</h3><label>自动参战<input id="bossEnabled" type="checkbox"></label>
    <label>本机参战时段<span class="row"><input id="bossStart" type="text" aria-label="开始时间" placeholder="08:00">—<input id="bossEnd" type="text" aria-label="结束时间" placeholder="24:00"></span></label>
    <label>每轮跳过概率<span><input id="skipPercent" type="number" min="0" max="100" aria-label="跳过概率"> %</span></label>
    <p class="note">24 小时制，可跨午夜；相同起止时间表示全天。时段外不检测，已由助手加入的战斗会退出。0% 表示每轮均尝试加入。</p><div id="bossStatus" class="note"></div>
    <h3>种菜收菜</h3><label>自动收获补种<input id="farmEnabled" type="checkbox"></label>
    <label for="harvestMode">收菜条件</label><select id="harvestMode"><option value="all">所有作物成熟后收菜</option><option value="seed">任一相同种子的田全熟后收菜</option></select>
    <label>随机延迟（分钟）<span class="row"><input id="delayMin" type="number" min="0" max="1440" step="0.1" aria-label="最短延迟">—<input id="delayMax" type="number" min="0" max="1440" step="0.1" aria-label="最长延迟"></span></label>
    <label for="plantMode">补种方式</label><select id="plantMode"><option value="game">依照游戏逐田选择</option><option value="last">沿用每块田上次种植</option></select>
    <div id="fields"></div>
    <p class="note">逐田选择会保存到游戏。未指定的空田按游戏默认作物补种；没有任何选择或历史种植时等待你设置。修改任一田会切回逐田选择。</p>
    <p class="note">按精确种子品质分组。触发后原生整批收种，会顺带收其他成熟田；仅用已有或收回的种子，包含传说种子。完成后由游戏恢复原任务和队列。</p><div id="farmStatus" class="note"></div>
    <p class="note">设置自动保存。请停用综合助手后使用本脚本。掉落记录在聊天栏「Boss 掉落」，仅记录服务器发来的本人结算。</p><a href="https://github.com/ljyoukong-cpu/deepvein-idle-helper" target="_blank" rel="noopener noreferrer">GitHub 项目主页 ↗</a></div></section>`;
    fieldControls=createFarmControls(document,root.querySelector('#fields'),GAME_DATA,intent=>{
      if(!connected())return;
      settings={...settings,plantMode:'game',cropJobId:null};localStorage.setItem(key,JSON.stringify(settings));fill();send(intent);
    },gameLabel);
    fill();
    root.querySelector('#toggle').onclick=()=>{
      if(active){stopOwnBoss();active=false;status='已暂停';release();}
      else if(!connected())status='请先进入角色；若已进入，请刷新游戏';
      else if(!lease())status='另一份助手正在运行，请先暂停它';
      else{active=true;status='运行中';lastSync=-Infinity;}
      save();pump();
    };
    ui=createFieldBossUi(document,host,root,()=>root.querySelector('#toggle').click());
    for(const field of Object.keys(settings)){const control=root.querySelector(`#${field}`);if(!control)continue;control.onchange=()=>{
      const value={...settings,cropJobId:null};for(const name of Object.keys(settings)){const el=root.querySelector(`#${name}`);if(el)value[name]=name.endsWith('Enabled')?el.checked:el.value;}
      settings=normalizeFieldBossSettings(value);localStorage.setItem(key,JSON.stringify(settings));fill();pump();
    };}
  }
  function fill(){for(const [name,value]of Object.entries(settings)){const el=root.querySelector(`#${name}`);if(!el)continue;if(name.endsWith('Enabled'))el.checked=value;else el.value=value??'';}}
  function render(){if(!root)return;fieldControls?.(player);root.querySelector('#status').textContent=status;root.querySelector('#toggle').textContent=active?'暂停':'开始';root.querySelector('#bossStatus').textContent=bossStatus;root.querySelector('#farmStatus').textContent=farmStatus;ui?.update({active,status,bossStatus,farmStatus});}
  mount();setInterval(pump,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastSync=-Infinity;pump();}});
  window.addEventListener('pagehide',()=>{save();release();});
})();

})();
