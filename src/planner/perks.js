// Quest-point perks (client 1.0.1189, `buyPerk {id}`). Points come only from
// quests (+1 daily, +3 weekly) and buy permanent ranks, so holding them earns
// nothing; spend on the best measured gain per point.
export const PERKS=[
  {id:'pockets',name:'大口袋',ranks:5,cost:n=>20+20*n},
  {id:'quick',name:'快手',ranks:10,cost:n=>15+10*n},
  {id:'hands',name:'稳手',ranks:10,cost:n=>10+8*n},
  {id:'meals',name:'丰盛餐食',ranks:10,cost:n=>10+8*n},
  {id:'rest',name:'快速休息',ranks:4,cost:n=>30+30*n},
];
export const perkById=id=>PERKS.find(perk=>perk.id===id)??null;

export function perkRank(p,id){return Number.isInteger(p.perks?.[id])?p.perks[id]:0;}
export function nextPerkCost(p,id) {
  const perk=perkById(id),rank=perkRank(p,id);
  return !perk||rank>=perk.ranks?null:perk.cost(rank);
}

// What the account actually does: the current goal plus the routes with the
// most measured time (Telemetry rates), weighted by that time.
function perkActivities(planner,goal,usage) {
  const rows=[];
  const add=(activity,weight)=>{if(activity!=null&&weight>0)rows.push({activity,weight});};
  if(goal?.monsterId!=null)add({monsterId:goal.monsterId},3600);
  else if(goal?.recipeId!=null)add(goal.recipeId,3600);
  const routes=Object.entries(usage??{}).filter(([,m])=>m?.seconds>0&&!m.simulated)
    .sort((a,b)=>b[1].seconds-a[1].seconds).slice(0,5);
  for(const [key,m]of routes) {
    const [kind,id]=key.split(':');
    if(kind==='combat')add({monsterId:Number(id)},m.seconds);
    else if(kind==='job'&&Number.isInteger(Number(id)))add(Number(id),m.seconds);
  }
  return rows;
}

// Time-weighted relative gain of one more rank of `id` over those activities.
// Pockets, quick and steady hands change work and banking; meals change combat
// food. Quick rest is not modelled and is never bought automatically.
function perkGain(planner,p,activities,style,id,metric) {
  if(id==='rest'||!activities.length)return 0;
  const options={style,ignoreStock:true,completeTrips:true};
  let gain=0,weight=0;
  for(const {activity,weight:w}of activities) {
    const before=planner.routeEstimate(p,activity,50,options);
    const after=planner.routeEstimate({...p,perks:{...p.perks,[id]:perkRank(p,id)+1}},activity,50,options);
    const a=before.rate?.[metric],b=after.rate?.[metric];
    if(!(Number.isFinite(a)&&a>0&&Number.isFinite(b)))continue;
    gain+=w*Math.max(0,b/a-1);weight+=w;
  }
  return weight?gain/weight:0;
}

// Buy only a perk with a measured gain on what this account does, and only
// the best gain per point: if that perk is not affordable yet, save for it
// rather than spend on a cheaper, weaker one.
function scorePerks(planner,p,goal,style,usage) {
  const activities=perkActivities(planner,goal,usage);
  if(!activities.length)return [];
  const metric=goal?.specialization&&goal.rate?.coins>0?'coins':'xp';
  return PERKS.map(perk=>({perk,cost:nextPerkCost(p,perk.id)})).filter(row=>row.cost!=null)
    .map(row=>({...row,gain:perkGain(planner,p,activities,style,row.perk.id,metric)}))
    .map(row=>({...row,value:row.gain/row.cost})).filter(row=>row.value>0)
    .sort((a,b)=>b.value-a.value);
}

// For the plan panel: points held and the perk they are going to.
export function perkOverview(planner,p,goal=null,style='magic',{usage=null}={}) {
  if(!Number.isInteger(p?.questPoints))return null;
  const best=scorePerks(planner,p,goal,style,usage)[0];
  return {points:p.questPoints,next:best?{name:best.perk.name,rank:perkRank(p,best.perk.id)+1,cost:best.cost,gain:best.gain,
    affordable:best.cost<=p.questPoints}:null};
}

export function choosePerk(planner,p,goal=null,style='magic',{usage=null}={}) {
  const points=p.questPoints;
  if(!Number.isInteger(points)||points<=0||!p.perks||typeof p.perks!=='object')return null;
  const choice=scorePerks(planner,p,goal,style,usage)[0];
  if(!choice||choice.cost>points)return null;
  const rank=perkRank(p,choice.perk.id)+1;
  return {intent:{t:'buyPerk',id:choice.perk.id},label:`任务点数兑换 · ${choice.perk.name} ${rank} 级`,
    reason:`花费 ${choice.cost} 任务点数（现有 ${points}）；按当前目标与常做工作估算效率 +${(choice.gain*100).toFixed(2)}%，`+
      '是每点收益最高的特权；没有可测收益的特权不兑换，最优特权点数不足时先保留'};
}
