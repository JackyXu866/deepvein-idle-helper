import {professionSkill} from './professions.js';
import {workEstimate} from './estimates.js';

export function createQuests(data,planner) {
  const dayTicks=86400000/data.tickMs;
  const title=q=>q.kind==='kill'?data.monsters.find(m=>m.id===q.monsterId)?.name:
    data.jobs.find(j=>j.id===q.jobId)?.name;
  function read(p) {
    if(!p?.quests||!Number.isFinite(p.lastTick)||p.lastTick<0)return [];
    const day=Math.floor(p.lastTick/dayTicks),rows=[];
    for(const [period,field,current,length]of [['daily','day',day,dayTicks],['weekly','week',Math.floor(day/7),7*dayTicks]]) {
      const stamp=p.quests[field];
      if(stamp!==current||!Array.isArray(p.quests[period]))continue;
      for(const q of p.quests[period]) {
        if(!q||typeof q.id!=='string'||!q.id||!['gather','craft','kill'].includes(q.kind)||
          !Number.isInteger(q.goal)||q.goal<=0||!Number.isInteger(q.done)||q.done<0||
          typeof q.claimed!=='boolean'||!data.skills.includes(q.reward?.skill)||
          !Number.isFinite(q.reward?.xp)||q.reward.xp<0||!Number.isFinite(q.reward?.coins)||q.reward.coins<0)continue;
        rows.push({...q,period,stamp,key:`${period}:${stamp}:${q.id}`,
          remaining:Math.max(0,q.goal-q.done),expiresAtTick:(stamp+1)*length});
      }
    }
    return rows;
  }
  function claim(p,style='magic') {
    const gear=planner.equipmentStats(p.equipment.weapon);
    const activeSkill=gear?.magic?'magic':gear?.ranged?'ranged':'melee';
    const q=read(p).find(q=>!q.claimed&&!q.remaining&&(q.kind!=='kill'||activeSkill===professionSkill(style)));
    if(!q)return null;
    const skill=q.kind==='kill'?activeSkill:q.reward.skill;
    return {intent:{t:'claimQuest',id:q.id},label:`领取${q.period==='daily'?'每日':'每周'}任务 · ${title(q)??q.id}`,
      reason:`领取 ${q.reward.coins} 金币与 ${q.reward.xp} ${skill} 经验；不打断当前任务`};
  }
  function chooseGoal(p,baseline,style='magic',deferred={}) {
    const levels=planner.levels(p),choices=[],coinThreshold=Math.max(0,baseline?.rate?.coins??0,planner.coinRate?.(p)??0);
    for(const q of read(p)) {
      if(q.claimed||!q.remaining||deferred[q.key])continue;
      const job=q.kind==='kill'?null:data.jobs.find(j=>j.id===q.jobId);
      const skill=q.kind==='kill'?professionSkill(style):job?.skill;
      if(!skill||!planner.trainedSkills(style).includes(skill)||job&&(job.grow||job.levelReq>levels[skill]))continue;
      if(q.kind==='kill'&&!data.monsters.some(m=>m.id===q.monsterId))continue;
      // Progress counts successful produced events, including rare results,
      // once per action. Existing output stock cannot substitute for the work.
      const success=job?workEstimate(data,job,levels[skill],{hands:p.perks?.hands??0}).success:1;
      if(!(success>0))continue;
      const estimate=planner.routeEstimate(p,job??{monsterId:q.monsterId},Math.ceil(q.remaining/success),{style,buyInputs:true});
      const seconds=estimate.seconds,left=(q.expiresAtTick-p.lastTick)*data.tickMs/1000;
      const horizon=q.period==='daily'?1200:600;
      if(!Number.isFinite(seconds)||seconds<=0||seconds>horizon||seconds>left)continue;
      const rate={xp:(estimate.xp+q.reward.xp)/seconds,coins:(estimate.coins+q.reward.coins)/seconds};
      if(baseline?.specialization&&skill!==baseline.mainSkill&&rate.coins<coinThreshold*1.2)continue;
      const dailyPriority=q.period==='daily'&&(q.reward.xp>0||q.reward.coins>0);
      if(!dailyPriority&&!(rate.xp>0&&rate.xp>=(baseline?.rate?.xp??0))&&!(rate.coins>0&&rate.coins>=coinThreshold))continue;
      const quest={key:q.key,id:q.id,period:q.period,stamp:q.stamp,kind:q.kind,
        ...(job?{jobId:job.id}:{monsterId:q.monsterId})};
      choices.push({skill,...(job?{recipeId:job.id}:{monsterId:q.monsterId}),batch:q.remaining,
        target:levels[skill]+1,stage:baseline?.stage,growth:true,quest,rate,budget:estimate.budget,
        ...(baseline?.specialization?{specialization:true,mainSkill:baseline.mainSkill,manualTrade:baseline.manualTrade}:{}),
        recipes:{...estimate.recipes,...(job?{[skill]:job.id}:{})},supplyRecipes:estimate.supplyRecipes,
        horizon,estimate,urgent:left<=seconds+(baseline?.horizon??1800),
        reason:`优先${q.period==='daily'?'每日':'每周'}任务 · ${title(q)}：剩 ${q.remaining} 次，`+
          `预计 ${Math.ceil(seconds/60)} 分钟；含奖励 ${Math.round(rate.xp*60)} 经验/分、${Math.round(rate.coins*60)} 金币/分`});
    }
    choices.sort((a,b)=>Number(b.quest.period==='daily')-Number(a.quest.period==='daily')||
      Number(b.urgent)-Number(a.urgent)||b.rate.xp-a.rate.xp||b.rate.coins-a.rate.coins||
      a.estimate.seconds-b.estimate.seconds||a.quest.key.localeCompare(b.quest.key));
    return choices[0]??null;
  }
  function completed(p,goal) {
    if(!goal?.quest)return false;
    const q=read(p).find(q=>q.key===goal.quest.key);
    return !q||q.claimed||q.remaining===0;
  }
  return {read,claim,chooseGoal,completed};
}
