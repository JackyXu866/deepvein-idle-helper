// "补精通" (upstream v0.8.2–v0.8.5): earn mastery points where they cost the
// least gold per point. Two sources (client 1.0.1210, Yd = collections + forge
// log): the next tier of a collection (personal production only: stock,
// market buys and World Boss loot do not count), and the forge log, which pays
// the first time a piece of an enhancement tier and quality reaches each +N.
// Ladders follow the native collection page.
import {professionSkill} from './professions.js';
import {LEGENDARY, PAIR_TIERS} from './quality.js';
import {itemName, qualityName} from './items.js';

export const MASTERY_STEPS=[1,10,100,1000,10000,100000,1000000,10000000];
export const MASTERY_REWARDS=[1,1,3,10,35,120,420,1500];
export const MASTERY_QUALITY=[1,3,10,30];
// Forge log: tier t (0-5, enhanceGold's ladder) and quality r reaching +a
// (1-15) for the first time pays max(5, round(gold[t]*rarity[r]*ladder[a]/500000)).
export const FORGE_LADDER=[1,2,3,4,5,8,10,14,20,31,51,93,200,557,1667];
const FORGE_RARITY=[1,3,8,20,50];
export const forgePoints=(data,tier,rarity,plus)=>plus<1||plus>FORGE_LADDER.length?0:
  Math.max(5,Math.round(data.enhanceGold[tier]*FORGE_RARITY[rarity]*FORGE_LADDER[plus-1]/5e5));
export const forgeReached=(p,tier,rarity,plus)=>((p.forgeLog?.[tier*5+rarity]??0)>>>(plus-1))%2===1;

// Legendary is the player's; crops are left to the farming rules (v0.8.4).
export const skipMastery=(data,base,rarity=0)=>rarity>=LEGENDARY||data.jobs.some(j=>j.grow&&j.output.itemId===base);

// Every collection's next tier (items already started), with its points.
export function masteryCandidates(data,p) {
  if(!p?.collections)return [];
  const bases=new Set();
  for(const job of data.jobs){bases.add(job.output.itemId);if(job.bonus)bases.add(job.bonus.itemId);}
  for(const monster of data.monsters){bases.add(monster.drop);if(monster.bonus)bases.add(monster.bonus.itemId);}
  const result=[];
  for(const base of bases) {
    // Single-entry companions and appearances have no next step once found.
    if(!data.items[base]||base===data.coinId||base===data.shardId||skipMastery(data,base)||
      base>=280&&base<293||base>=316&&base<323||base>=400&&base<=410)continue;
    for(const rarity of [...PAIR_TIERS].reverse()) {
      const itemId=base+rarity*data.rarityScale,count=p.collections[itemId]??0;
      if(!Number.isSafeInteger(count)||count<=0)continue;
      const step=MASTERY_STEPS.findIndex(n=>n>count);if(step<0)continue;
      const target=MASTERY_STEPS[step],previous=MASTERY_STEPS[step-1]??0,frac=(count-previous)/(target-previous);
      const points=MASTERY_REWARDS[step]*MASTERY_QUALITY[rarity];
      result.push({itemId,base,rarity,target,frac,reward:points,points});
    }
  }
  return result.sort((a,b)=>b.frac-a.frac||b.reward-a.reward);
}

// `price(p,target,style)`: gold to finish a collection tier (its time at the
// gold rate); `forge(p,style)`: the forge targets with their points and gold
// (time included). The work goes to the collection with the least gold per
// point; enhancing runs beside it, on a forge level only while that is cheaper
// per point. The list is drawn again when one is done (or every 10 minutes).
export function createCollectionMastery(data,{price=null,forge=null}={}) {
  let owner=null,ranked=[],rankedAt=-Infinity;
  const count=(p,target)=>p.collections?.[target.itemId]??0;
  const name=target=>target.forge?`${qualityName(target.rarity)} ${target.tier+1} 档强化记录（${itemName(data,target.base)}）`:
    `${qualityName(target.rarity)} ${itemName(data,target.base)}`;
  const perPoint=t=>Math.round(t.gold/t.points).toLocaleString();
  function rank(p,style) {
    if(owner===p.id&&p.lastTick-rankedAt<Math.ceil(600000/data.tickMs))return ranked;
    owner=p.id;rankedAt=p.lastTick;
    const collections=masteryCandidates(data,p).map(t=>({...t,gold:price?.(p,t,style)??Infinity}));
    ranked=[...collections,...(forge?.(p,style)??[])].filter(t=>t.points>0&&Number.isFinite(t.gold))
      .sort((a,b)=>a.gold/a.points-b.gold/b.points||b.points-a.points);
    return ranked;
  }
  // A piece held at any +N (a forge level's piece to make is then done).
  const held=(p,id)=>Object.values(p.equipment??{}).some(e=>e!=null&&e%data.plusScale===id)||
    Object.entries(p.bank??{}).some(([e,n])=>n>0&&Number(e)%data.plusScale===id);
  function chooseGoal(p,style='magic') {
    if(!p.collections)return null;
    // The work: the cheapest collection, or making the piece a cheaper forge level needs.
    const target=rank(p,style).find(t=>!t.forge||t.make&&!held(p,t.itemId));if(!target)return null;
    if(target.make) {
      const job=data.jobs.find(j=>j.output.itemId===target.base&&j.inputs.length&&!j.grow);
      return {mastery:{...target},skill:job?.skill??professionSkill(style),target:Infinity,recipeId:job?.id,budget:{coins:0,items:{}},
        reason:`补精通 · 自制 ${qualityName(target.rarity)} ${itemName(data,target.base)} 用于${name(target)} → +${target.toPlus}：${target.points} 点，约 ${perPoint(target)} 金币/点（含制作时间，当前最划算）`};
    }
    const job=data.jobs.find(j=>j.output.itemId===target.base)??data.jobs.find(j=>j.bonus?.itemId===target.base);
    return {mastery:{...target},skill:job?.skill??professionSkill(style),target:Infinity,
      recipeId:job?.id,budget:{coins:0,items:{}},
      reason:`补精通 · ${name(target)}：${count(p,target)} / ${target.target}，${target.points} 点，约 ${perPoint(target)} 金币/点（当前最划算）`};
  }
  // The forge level to enhance toward beside the work: the cheapest per point,
  // only while it is cheaper than the work's collection.
  function forgeNext(p,style='magic',goal=null) {
    if(!p.forgeLog)return null;
    // A level reached since the list was drawn: draw it again (the next level is priced anew).
    if(rank(p,style).some(t=>t.forge&&forgeReached(p,t.tier,t.rarity,t.toPlus)))rankedAt=-Infinity;
    const work=goal?.mastery?.points>0&&Number.isFinite(goal.mastery.gold)?goal.mastery.gold/goal.mastery.points:Infinity;
    return rank(p,style).find(t=>t.forge&&!(t.make&&!held(p,t.itemId))&&t.gold/t.points<=work)??null;
  }
  function completed(p,goal) {
    const done=goal.mastery.make?held(p,goal.mastery.itemId):!!p.collections&&count(p,goal.mastery)>=goal.mastery.target;
    if(done)rankedAt=-Infinity;
    return done;
  }
  const skipped=goal=>!goal.mastery.forge&&skipMastery(data,goal.mastery.base,goal.mastery.rarity);
  function status(p,style='magic') {
    if(!p?.collections)return '等待服务器收藏计数；购买成品不计入精通。';
    const targets=rank(p,style).slice(0,6);
    return targets.length?targets.map((t,index)=>`${index+1}. ${name(t)}${t.forge?` → +${t.toPlus}${t.acquire&&t.acquire!=='已持有'?`（${t.acquire === '市场'?'先买':'先做'}一件）`:''}`:`：${count(p,t)} / ${t.target}`}，${t.points} 点，约 ${perPoint(t)} 金币/点`).join('\n'):
      '暂无可补的奖励项（已跳过传说与种植）；等待收藏进度变化。';
  }
  return {chooseGoal,forgeNext,completed,skipped,status,name,reset:()=>{owner=null;ranked=[];rankedAt=-Infinity;},
    runtime(value){if(value){owner=value.owner??null;ranked=value.ranked??[];rankedAt=value.rankedAt??-Infinity;}
      return {owner,ranked,rankedAt};}};
}
