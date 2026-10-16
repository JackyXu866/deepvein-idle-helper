// ==UserScript==
// @name         Deep Vein Idle 世界 Boss 与种菜助手
// @namespace    local.deepvein.field-boss
// @version      0.1.0
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
const SCRIPT_VERSION="0.1.0";
const GAME_DATA={"protocol":3,"tickMs":600,"xp":{"journeyLevel":99,"baseXp":100,"growth":1.12,"beyondStep":0.1,"beyondGrowth":1.145,"speedPerLevelAboveRequirement":0.005},"farmUnlocks":[1,1,15,30,45,60],"farmWaterTrim":20,"plusScale":10000,"rarityScale":1000,"jobs":[{"id":160,"name":"Potato","skill":"farming","group":"Crops","levelReq":1,"baseTicks":2,"xp":110,"inputs":[{"itemId":160,"qty":1}],"output":{"itemId":170,"qty":1},"grow":800},{"id":161,"name":"Glowcap","skill":"farming","group":"Crops","levelReq":15,"baseTicks":2,"xp":380,"inputs":[{"itemId":161,"qty":1}],"output":{"itemId":171,"qty":1},"grow":1500},{"id":162,"name":"Cave turnip","skill":"farming","group":"Crops","levelReq":30,"baseTicks":2,"xp":900,"inputs":[{"itemId":162,"qty":1}],"output":{"itemId":172,"qty":1},"grow":2500},{"id":163,"name":"Bitterroot","skill":"farming","group":"Crops","levelReq":45,"baseTicks":2,"xp":1900,"inputs":[{"itemId":163,"qty":1}],"output":{"itemId":173,"qty":1},"grow":4000},{"id":164,"name":"Voidmelon","skill":"farming","group":"Crops","levelReq":60,"baseTicks":2,"xp":3800,"inputs":[{"itemId":164,"qty":1}],"output":{"itemId":174,"qty":1},"grow":6000},{"id":165,"name":"Ember pepper","skill":"farming","group":"Crops","levelReq":75,"baseTicks":2,"xp":6500,"inputs":[{"itemId":165,"qty":1}],"output":{"itemId":175,"qty":1},"grow":9000},{"id":210,"name":"Sage","skill":"farming","group":"Herbs","levelReq":10,"baseTicks":2,"xp":260,"inputs":[{"itemId":190,"qty":1}],"output":{"itemId":193,"qty":1},"grow":1200},{"id":211,"name":"Nightshade","skill":"farming","group":"Herbs","levelReq":35,"baseTicks":2,"xp":1200,"inputs":[{"itemId":191,"qty":1}],"output":{"itemId":194,"qty":1},"grow":3000},{"id":212,"name":"Dragonleaf","skill":"farming","group":"Herbs","levelReq":65,"baseTicks":2,"xp":4600,"inputs":[{"itemId":192,"qty":1}],"output":{"itemId":195,"qty":1},"grow":7000}],"sites":[{"id":74,"x":207,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":75,"x":209,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":76,"x":211,"y":93,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":77,"x":207,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":78,"x":209,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]},{"id":79,"x":211,"y":97,"kind":"field","jobIds":[160,161,162,163,164,165,210,211,212]}]};
// Policy for the independent helper. No route ownership or combat prediction.
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
    delayMin:Math.min(a,b),delayMax:Math.max(a,b),cropJobId:Number.isSafeInteger(value.cropJobId)?value.cropJobId:null};
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

function farmBatch(data,p,settings) {
  const empty={key:null,intent:null,ripe:0,planted:0,reason:'等待作物成熟'};
  if(!p?.skills||!Number.isFinite(p.lastTick))return {...empty,reason:'等待角色状态'};
  const base=id=>id%data.plusScale%data.rarityScale;
  const level=data.farmUnlocks.filter(n=>p.skills.farming>=Math.round(data.xp.baseXp*(data.xp.growth**(n-1)-1)/(data.xp.growth-1))).length;
  const fields=data.sites.filter(s=>s.kind==='field').sort((a,b)=>a.id-b.id).slice(0,level);
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
  const seedCount=job=>Object.entries(p.bank??{}).concat(Object.entries(p.overflow??{}),
    (p.pack??[]).map(row=>[row.itemId,row.qty])).filter(([id])=>base(+id)===job.inputs[0].itemId).reduce((n,[,qty])=>n+qty,0);
  const eligible=jobs.filter(job=>(settings.cropJobId==null||job.id===settings.cropJobId)&&
    p.skills.farming>=Math.round(data.xp.baseXp*(data.xp.growth**(job.levelReq-1)-1)/(data.xp.growth-1))&&
    (seedCount(job)>=job.inputs[0].qty||ripe.some(row=>row.job.id===job.id)));
  // Prefer the crop already in the fields; empty fields use available seeds only.
  const job=eligible.find(job=>ripe.some(row=>row.job.id===job.id))??eligible.sort((a,b)=>b.levelReq-a.levelReq)[0];
  if(!job)return {...state,reason:'缺少可用种子；不自动购买或采种'};
  const site=ripe[0]?.site??fields.find(site=>!p.plots?.[site.id]);if(!site)return state;
  // Use the entire planting generation, not the growing subset; maturation of
  // another group during the delay must not restart the clock.
  const key=plots.length?plots.map(row=>`${row.site.id}:${row.plot.seedItemId}:${row.plot.plantedAt}`).join('|'):`empty:${job.id}`;
  return {...state,key,job,reason:plots.length?'整批已满足收菜条件':'用已有种子补空田',
    intent:{t:'setRoute',siteId:site.id,jobId:job.id,onFull:'bank',limit:0,errand:true}};
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
  let received=0,frameTick=0,lastSync=-Infinity,round=null,owned=null,lastClick=-Infinity,goneAt=-Infinity;
  let policy=createFieldBossPolicy(),pendingFarm=null,root=null,status='已暂停',bossStatus='等待开始',farmStatus='等待开始';
  let leaveButton=null,wasInside=false,savedText='';
  const history=createBossLootHistory(GAME_DATA,localStorage),chat=createBossLootChat(document,history,translateGameText);
  const runtimeKey=()=>`${key}:${player?.id}`;
  function save(){
    if(!player)return;
    const value=JSON.stringify({active,round,owned,lastClick,policy:policy.save()});
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
  const visible=el=>!!el?.isConnected&&!el.hidden&&!el.disabled&&!el.closest('[hidden]')&&el.getClientRects().length>0;
  function bossControls(){
    const pill=document.querySelector('[data-boss-pill]'),run=document.querySelector('[data-boss-run]');
    const shownPill=visible(pill),text=pill?.querySelector('.boss-pill-join')?.textContent?.trim()??'';
    const busy=shownPill&&/^(Show|显示|查看)$/i.test(text)||visible(document.querySelector('[data-boss-leave]'));
    const button=shownPill&&/^(Join|加入|加入战斗)$/i.test(text)?pill:visible(run)&&/^(Run to it|Attack|跑过去|攻击|前往|赶过去)$/i.test(run.textContent.trim())?run:null;
    const name=(shownPill?document.querySelector('[data-boss-pill-name]'):document.querySelector('[data-boss-name]'))?.textContent?.trim()||'世界 Boss';
    return {button,busy,name};
  }
  function stopOwnBoss(){
    if(!owned)return;
    // The native handler clears its approach loop as well as sending Leave.
    // Reacquire this known exit control after a page reload, only for our run.
    const exitButton=leaveButton?.isConnected?leaveButton:document.querySelector('[data-boss-leave]');
    if(exitButton)exitButton.click();
    else send({t:'leaveWorldBoss'});
    owned=null;leaveButton=null;
  }
  function pump(){
    if(!root)mount();
    chat.refresh();
    if(!active){render();return;}
    if(!connected()){status='等待游戏连接';render();return;}
    if(!lease()){active=false;status='另一份助手正在运行，请先暂停它';save();render();return;}
    const now=Date.now(),inside=settings.bossEnabled&&inBossWindow(settings,now);
    if(!inside){
      stopOwnBoss();bossStatus=settings.bossEnabled?'当前不在参战时段':'世界 Boss 已关闭';
    }else{
      if(!wasInside){
        lastSync=-Infinity;
        if(round&&!round.expiresAt&&now-round.seenAt>10000){round=null;owned=null;}
      }
      const ui=bossControls();
      if(round?.expiresAt&&now>=round.expiresAt){round=null;owned=null;}
      if(ui.button||ui.busy){
        if(!round&&now-goneAt>2000)round={key:`dom:${ui.name}:${now}`,name:ui.name,seenAt:now};
        if(round)round.seenAt=now;
      }else if(round&&!round.expiresAt&&now-round.seenAt>10000){round=null;owned=null;}
      if(ui.busy){
        if(owned&&!leaveButton)leaveButton=document.querySelector('[data-boss-leave]');
        bossStatus=owned?.hit?'服务器已确认有效伤害，继续参战':'游戏正在赶路或参战';
      }else if(round){
        const choice=policy.boss(round.key,settings);
        if(choice==='skip')bossStatus='本轮按设置的概率跳过';
        else if(ui.button&&now-lastClick>=15000){
          lastClick=now;owned={key:round.key,hit:false};
          leaveButton=document.querySelector('[data-boss-leave]');
          // Let every native command through, including setAside, supply and walk.
          ui.button.click();bossStatus='已点击游戏“加入”，等待游戏赶路／攻击';
        }else bossStatus=owned?'已请求加入，等待游戏响应':'发现 Boss，等待游戏加入按钮';
      }else bossStatus='正在等待世界 Boss';
      // Farm errands must not replace the native approach or attack route.
      if(ui.busy||owned){wasInside=inside;status='运行中';save();render();sync(now);return;}
    }
    wasInside=inside;
    if(!settings.farmEnabled){farmStatus='种菜已关闭';policy.farm(null,settings);}
    else if(now-received>45000)farmStatus='等待最新农田状态';
    else{
      const p={...player,lastTick:Math.max(player.lastTick??0,frameTick)};
      const batch=farmBatch(GAME_DATA,p,settings);
      const scheduled=policy.farm(batch.key,settings);
      farmStatus=`${batch.ripe}/${batch.planted} 块成熟 · ${batch.reason}`;
      const busy=p.held||p.raidHeld||p.route?.errand||p.enhance||!p.route&&(p.path?.length||p.activity==='walking');
      if(pendingFarm&&received>pendingFarm.sentAt){
        if(p.route?.errand||batch.key!==pendingFarm.key)pendingFarm=null;
        else if(now-pendingFarm.sentAt>30000)pendingFarm=null;
      }
      if(p.route?.errand)farmStatus='游戏正在整批收获补种，完成后恢复原任务';
      else if(scheduled&&!scheduled.ready&&batch.planted)farmStatus+=` · 约 ${Math.ceil((scheduled.dueAt-now)/60000)} 分钟后出发`;
      else if(scheduled&&(!batch.planted||scheduled.ready)&&!busy&&!pendingFarm){
        send(batch.intent);pendingFarm={key:batch.key,sentAt:now};farmStatus='已发起原生整批收获补种';
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
              policy=createFieldBossPolicy({saved:saved?.policy});round=saved?.round??null;owned=saved?.owned??null;
              lastClick=saved?.lastClick??-Infinity;pendingFarm=null;savedText='';
            }
            if(!compatible){active=false;status='游戏协议已变化，已暂停';}
            frameTick=frame.tick;received=Date.now();
          }
          for(const m of frame.m){
            if(m.t==='snapshot'&&player&&m.you?.id===player.id&&frame.tick>=frameTick){player=m.you;frameTick=frame.tick;received=Date.now();changed=true;}
            if(!active||!settings.bossEnabled||!inBossWindow(settings,Date.now()))continue;
            if(m.t==='bossRose'&&typeof m.name==='string'&&Number.isFinite(m.until)){
              const same=round?.until===m.until&&round?.name===m.name;
              const promote=round&&!round.until&&(round.name==='世界 Boss'||translateGameText(round.name)===translateGameText(m.name));
              if(!same&&!promote){round={key:`${m.name}:${m.until}`,name:m.name};owned=null;lastClick=-Infinity;}
              round.name=m.name;round.until=m.until;round.expiresAt=Date.now()+(m.until-frame.tick)*GAME_DATA.tickMs;round.seenAt=Date.now();
              changed=true;
            }
            if(m.t==='bossGone'||m.t==='bossHp'&&m.hpRemaining===0){round=null;owned=null;goneAt=Date.now();changed=true;}
            if(m.t==='raidHit'&&m.damage>0&&owned){owned.hit=true;changed=true;}
          }
          // Native listeners must update their state and button labels first.
          if(changed)setTimeout(pump,0);
        }catch(error){active=false;status=`已暂停：${error.message}`;release();render();}
      });
      this.addEventListener('close',event=>{if(socket===this){compatible=false;if(event.code===4001||event.code===4002)active=false;save();release();}});
    }
  };
  function mount(){
    if(root||!document.body)return;
    const host=document.createElement('div');host.id='dv-field-boss';document.body.append(host);root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>
      :host{position:fixed;right:14px;top:75px;z-index:2147483000;color:#eddbb7;font:13px/1.6 system-ui,sans-serif;width:min(330px,calc(100vw - 20px))}
      *{box-sizing:border-box}section{background:#2b1c0e;border:1px solid #bc8b44;border-radius:9px;box-shadow:0 6px 22px #0006;padding:14px;max-height:calc(100dvh - 95px);overflow:auto}
      header{display:flex;align-items:center;gap:8px}strong{font-size:17px;flex:1}small,.note{color:#c4ab80}button,input,select{font:inherit;color:inherit;background:#1e140b;border:1px solid #78582d;border-radius:4px;padding:5px 8px}
      button{cursor:pointer}button:hover{border-color:#edbf70}#toggle{background:#e2ac55;color:#291a0d;font-weight:700;width:100%;margin:10px 0}h3{font-size:14px;margin:14px 0 8px;border-top:1px solid #604622;padding-top:12px}
      label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}input[type=number]{width:75px}input[type=text]{width:76px}input[type=checkbox]{accent-color:#d9a552}select{width:100%;min-width:0}.row{display:flex;align-items:center;gap:7px}.note{font-size:12px;margin:7px 0;overflow-wrap:anywhere}a{color:#e6b665}#body[hidden]{display:none}
      @media(max-width:480px){:host{right:10px;top:55px}section{max-height:calc(100dvh - 75px)}}
    </style><section><header><strong>世界 Boss＋种菜</strong><small>v${SCRIPT_VERSION}</small><button id="collapse" aria-label="折叠面板">−</button></header>
    <div id="status" role="status">已暂停</div><div id="body"><button id="toggle">开始</button>
    <h3>世界 Boss</h3><label>自动参战<input id="bossEnabled" type="checkbox"></label>
    <label>本机参战时段<span class="row"><input id="bossStart" type="text" aria-label="开始时间" placeholder="08:00">—<input id="bossEnd" type="text" aria-label="结束时间" placeholder="24:00"></span></label>
    <label>每轮跳过概率<span><input id="skipPercent" type="number" min="0" max="100" aria-label="跳过概率"> %</span></label>
    <p class="note">24 小时制，可跨午夜；相同起止时间表示全天。时段外不检测，已由助手加入的战斗会退出。0% 表示每轮均尝试加入。</p><div id="bossStatus" class="note"></div>
    <h3>种菜收菜</h3><label>自动收获补种<input id="farmEnabled" type="checkbox"></label>
    <label for="harvestMode">收菜条件</label><select id="harvestMode"><option value="all">所有作物成熟后收菜</option><option value="seed">任一相同种子的田全熟后收菜</option></select>
    <label>随机延迟（分钟）<span class="row"><input id="delayMin" type="number" min="0" max="1440" step="0.1" aria-label="最短延迟">—<input id="delayMax" type="number" min="0" max="1440" step="0.1" aria-label="最长延迟"></span></label>
    <label for="cropJobId">补种作物</label><select id="cropJobId"><option value="">优先现有作物，空田用已有种子</option>${GAME_DATA.jobs.map(job=>`<option value="${job.id}">${gameLabel(job.name)} · ${job.levelReq} 级</option>`).join('')}</select>
    <p class="note">按精确种子品质分组。触发后原生整批收种，会顺带收其他成熟田；仅用已有或收回的种子，包含传说种子。完成后由游戏恢复原任务和队列。</p><div id="farmStatus" class="note"></div>
    <p class="note">设置自动保存。请停用综合助手后使用本脚本。掉落记录在聊天栏「Boss 掉落」，仅记录服务器发来的本人结算。</p><a href="https://github.com/ljyoukong-cpu/deepvein-idle-helper" target="_blank" rel="noopener noreferrer">GitHub 项目主页 ↗</a></div></section>`;
    fill();
    root.querySelector('#toggle').onclick=()=>{
      if(active){stopOwnBoss();active=false;status='已暂停';release();}
      else if(!connected())status='请先进入角色；若已进入，请刷新游戏';
      else if(!lease())status='另一份助手正在运行，请先暂停它';
      else{active=true;status='运行中';lastSync=-Infinity;}
      save();pump();
    };
    root.querySelector('#collapse').onclick=()=>{const body=root.querySelector('#body');body.hidden=!body.hidden;root.querySelector('#collapse').textContent=body.hidden?'+':'−';};
    for(const field of Object.keys(settings))root.querySelector(`#${field}`).onchange=()=>{
      const value={};for(const name of Object.keys(settings)){const el=root.querySelector(`#${name}`);value[name]=name.endsWith('Enabled')?el.checked:name==='cropJobId'?(el.value===''?null:Number(el.value)):el.value;}
      settings=normalizeFieldBossSettings(value);localStorage.setItem(key,JSON.stringify(settings));fill();pump();
    };
  }
  function fill(){for(const [name,value]of Object.entries(settings)){const el=root.querySelector(`#${name}`);if(name.endsWith('Enabled'))el.checked=value;else el.value=value??'';}}
  function render(){if(!root)return;root.querySelector('#status').textContent=status;root.querySelector('#toggle').textContent=active?'暂停':'开始';root.querySelector('#bossStatus').textContent=bossStatus;root.querySelector('#farmStatus').textContent=farmStatus;}
  mount();setInterval(pump,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastSync=-Infinity;pump();}});
  window.addEventListener('pagehide',()=>{save();release();});
})();

})();
