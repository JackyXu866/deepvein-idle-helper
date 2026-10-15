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

// Relative gain of the goal's activity with one more rank of `id`. Pockets,
// quick and steady hands change work and banking; meals change combat food.
// Quick rest is not modelled, so it is bought only when nothing else is left.
function perkGain(planner,p,goal,style,id) {
  const activity=goal?.monsterId!=null?{monsterId:goal.monsterId}:goal?.recipeId!=null?goal.recipeId:null;
  if(activity==null||id==='rest')return 0;
  const options={style,ignoreStock:true,completeTrips:true};
  const before=planner.routeEstimate(p,activity,50,options);
  const after=planner.routeEstimate({...p,perks:{...p.perks,[id]:perkRank(p,id)+1}},activity,50,options);
  const metric=goal.specialization&&before.rate?.coins>0?'coins':'xp';
  const a=before.rate?.[metric],b=after.rate?.[metric];
  return Number.isFinite(a)&&a>0&&Number.isFinite(b)?Math.max(0,b/a-1):0;
}

export function choosePerk(planner,p,goal=null,style='magic') {
  const points=p.questPoints;
  if(!Number.isInteger(points)||points<=0||!p.perks||typeof p.perks!=='object')return null;
  const affordable=PERKS.map(perk=>({perk,cost:nextPerkCost(p,perk.id)}))
    .filter(row=>row.cost!=null&&row.cost<=points);
  if(!affordable.length)return null;
  const scored=affordable.map(row=>({...row,gain:perkGain(planner,p,goal,style,row.perk.id)}))
    .map(row=>({...row,value:row.gain/row.cost}));
  // Without a measurable gain, fall back to the broadly useful order above,
  // keeping Quick rest last.
  const measured=scored.filter(row=>row.value>0).sort((a,b)=>b.value-a.value);
  const choice=measured[0]??scored.filter(row=>row.perk.id!=='rest')[0]??
    (PERKS.filter(perk=>perk.id!=='rest').every(perk=>perkRank(p,perk.id)>=perk.ranks)?scored[0]:null);
  if(!choice)return null;
  const rank=perkRank(p,choice.perk.id)+1;
  return {intent:{t:'buyPerk',id:choice.perk.id},label:`任务点数兑换 · ${choice.perk.name} ${rank} 级`,
    reason:`花费 ${choice.cost} 任务点数（现有 ${points}）`+
      (choice.gain>0?`；按当前工作估算效率 +${(choice.gain*100).toFixed(1)}%`:'；当前工作无法估算收益，按通用顺序兑换')+
      '；点数只能兑换永久特权，不保留'};
}
