import {professionSkill} from './professions.js';
import {workEstimate} from './estimates.js';
import {planEnhancement} from './enhancement.js';

// Own a development project, not a sequence of equal-level turns. Execution,
// material batching, market validation and equipment safety remain in planner.
export function createProgression(data,planner) {
  let owner=null,profession=null,focus=null,parked={},completed=0,visited={},alternatives=[];
  const farmLevel=Math.max(...data.farmUnlocks);
  const skillsFor=(p,style)=>planner.trainedSkills(style).filter(s=>!['enhancing','defence','hitpoints'].includes(s)&&
    (s!=='farming'||planner.level(p.skills.farming)<farmLevel));
  function reset(){owner=null;profession=null;focus=null;parked={};completed=0;visited={};alternatives=[];}
  function select(p,style) {
    if(owner===p.id&&profession===style)return;
    reset();owner=p.id;profession=style;
  }
  function finish(p) {
    for(const goal of [focus,...Object.values(parked)])if(goal?.skill==='farming')goal.target=Math.min(goal.target,farmLevel);
    if(focus&&planner.level(p.skills[focus.skill])>=focus.target) {
      visited[focus.skill]=++completed;delete parked[focus.skill];focus=null;
    }
  }
  function observe(p,goal,style='magic') {
    select(p,style);
    if(goal?.development) {
      if(goal.skill==='farming')goal.target=Math.min(goal.target,farmLevel);
      focus=goal;
      if(focus.progressXp!==p.skills[focus.skill]||focus.progressTick==null) {
        focus.progressXp=p.skills[focus.skill];focus.progressTick=p.lastTick;
      }
    } else if(focus&&(goal?.quest||goal?.itemTarget))focus.progressTick=p.lastTick;
  }
  function status(p,style='magic',deferred={}) {
    select(p,style);
    const lv=planner.levels(p),skills=skillsFor(p,style),eligible=skills.filter(s=>!deferred[s]);
    const lowestLevel=eligible.length?Math.min(...eligible.map(s=>lv[s])):null;
    const stage=lowestLevel===null?null:Math.min(planner.thresholds.length-1,(Math.floor(lowestLevel/5)+1)*5);
    const improvement=deferred.enhancing?null:planEnhancement(data,planner,p,style);
    return {stage,lowestLevel,completed,project:focus,alternatives,
      remaining:eligible.filter(s=>lv[s]<stage).map(skill=>({skill,level:lv[skill],target:stage})),
      deferred:skills.filter(s=>deferred[s]).map(skill=>({skill,level:lv[skill]})),
      enhancement:improvement?.enhancement??null};
  }
  function chooseGoal(p,served={},deferred={},style='magic') {
    select(p,style);finish(p);
    if(focus&&!deferred[focus.skill])return focus;
    if(focus){parked[focus.skill]=focus;focus=null;}
    const resume=Object.values(parked).find(g=>!deferred[g.skill]&&planner.level(p.skills[g.skill])<g.target);
    if(resume){focus=resume;focus.progressTick=p.lastTick;delete parked[resume.skill];return focus;}
    const lv=planner.levels(p),skills=skillsFor(p,style),maxLevel=planner.thresholds.length-1;
    const candidates=[...planner.candidates(p,style,deferred),...planner.candidates(p,style,deferred,{stockedBatch:true})],choices=[];
    const middle=[...skills.map(s=>lv[s])].sort((a,b)=>a-b)[Math.floor(skills.length/2)];
    for(const skill of skills.filter(s=>!deferred[s]&&lv[s]<maxLevel)) {
      // Do not credit a workshop for experience gained fetching its ingredients.
      let best=candidates.filter(c=>c.skill===skill)
        .sort((a,b)=>(b.mainXpRate??b.rate.xp)-(a.mainXpRate??a.rate.xp))[0];
      if(!best) {
        const job=data.jobs.filter(j=>j.skill===skill&&j.levelReq<=lv[skill]&&data.sites.some(s=>s.jobIds.includes(j.id)))
          .sort((a,b)=>b.xp/(b.baseTicks+(b.grow??0))-a.xp/(a.baseTicks+(a.grow??0)))[0];
        if(job) {
          const e=workEstimate(data,job,lv[skill]);
          best={recipeId:job.id,recipes:{[skill]:job.id},batch:50,budget:{coins:0,items:{}},
            rate:{xp:e.xp/(e.seconds+(job.grow??0)*data.tickMs/1000),coins:0},unpriced:true};
        } else if(skill===professionSkill(style))best={rate:{xp:0,coins:0},budget:{coins:0,items:{}},unpriced:true};
      }
      if(!best)continue;
      const unlocks=data.jobs.filter(j=>j.skill===skill&&j.levelReq>lv[skill]);
      const next=Math.min(...unlocks.map(j=>j.levelReq));
      const checkpoint=(Math.floor(lv[skill]/5)+1)*5;
      const target=Math.min(skill==='farming'?farmLevel:maxLevel,next<=lv[skill]+10?next:checkpoint);
      const xpRate=best.mainXpRate??best.rate.xp;
      const seconds=!best.unpriced&&xpRate>0?(planner.thresholds[target]-p.skills[skill])/xpRate:Infinity;
      const unlocked=unlocks.filter(j=>j.levelReq===target);
      const useful=unlocked.filter(j=>data.gear.some(g=>g.itemId===j.output.itemId)||
        data.jobs.some(other=>other.skill!==skill&&other.inputs.some(i=>i.itemId===j.output.itemId))).length;
      const debt=Math.max(0,middle-lv[skill]);
      const progress=(target-lv[skill])/Math.max(300,seconds);
      const score=best.unpriced?0:progress*(1+debt/10)*(1+Math.min(3,useful)*.25);
      choices.push({...best,skill,target,stage:target,growth:true,development:true,horizon:Math.max(1800,Math.min(7200,seconds||1800)),
        projectSeconds:seconds,score,unlockNames:unlocked.slice(0,3).map(j=>j.name),debt});
    }
    // A renewable batch pays for replacing its inputs. Owned materials shorten
    // leveling time but are not free inputs in a repeatable business forecast.
    const tradable=choices.filter(c=>c.output&&c.output.itemId!==data.coinId);
    planner.watchMarket?.(p,tradable.map(c=>c.output.itemId));
    const earning=planner.incomeChoices?.(p,choices.filter(c=>!c.unpriced).map(c=>{
      const estimate=planner.routeEstimate(p,c.recipeId??{monsterId:c.monsterId},50,{style,ignoreStock:true,completeTrips:true,buyInputs:true});
      const job=data.jobs.find(j=>j.id===c.recipeId);
      const output=job?{itemId:job.output.itemId,qty:Math.floor(planner.estimateWork(p,job).commonOutput*50)}:undefined;
      return {...c,output,estimate,rate:estimate.rate??{xp:0,coins:0}};
    }).filter(c=>Number.isFinite(c.estimate.seconds)),style)??[];
    const coinRate=Math.max(1,planner.coinRate?.(p)??0);
    for(const c of choices) {
      const income=earning.find(e=>e.skill===c.skill);
      c.incomeRate=income?.rate.coins??0;
      c.score*=1+Math.min(1,c.incomeRate/coinRate)*.5;
    }
    // Every fourth completed project can catch up the longest neglected skill.
    // A complete project, not a ten-minute timer, advances this rotation.
    const overdue=choices.filter(c=>completed-(visited[c.skill]??0)>=3);
    const catchUp=overdue.length&&completed%4===3;
    choices.sort((a,b)=>catchUp?((visited[a.skill]??0)-(visited[b.skill]??0)||b.debt-a.debt||b.score-a.score):b.score-a.score);
    const best=choices[0];if(!best)return null;
    const purpose=catchUp?'补齐长期未发展的能力':best.unlockNames.length?'解锁下一档生产能力':'集中提升当前能力';
    best.reason=`发展计划：${purpose}，${lv[best.skill]} → ${best.target} 级；`+
      (best.unlockNames.length?`解锁 ${best.unlockNames.join('、')}；`:'')+
      (Number.isFinite(best.projectSeconds)?`按现有供料条件约 ${Math.max(1,Math.ceil(best.projectSeconds/60))} 分钟；`:'先补齐装备与供料条件；')+
      (best.incomeRate>0?`可持续收入估计 ${Math.round(best.incomeRate*60)} 金币/分；`:'')+
      '先准备本计划装备和整批材料，达标后再选下一项';
    alternatives=choices.slice(1,4).map(c=>({skill:c.skill,target:c.target,seconds:c.projectSeconds}));
    best.developmentFiller=Object.keys(parked).length>0;
    if(best.developmentFiller)best.reason=`等待原计划条件期间，使用现有装备推进；${best.reason}`;
    focus=best;observe(p,focus,style);return focus;
  }
  function resumeReady(p,deferred,goal) {
    finish(p);
    const ready=Object.values(parked).find(g=>g.skill!==goal?.skill&&!deferred[g.skill]&&planner.level(p.skills[g.skill])<g.target);
    if(!ready)return null;
    // The intervening job was useful filler while this prerequisite matured.
    // Do not park it as another ready parent, which would alternate forever.
    focus=ready;focus.progressTick=p.lastTick;delete parked[ready.skill];return focus;
  }
  function runtime(value) {
    if(value) {
      const valid=g=>g?.development===true&&data.skills.includes(g.skill)&&
        Number.isInteger(g.target)&&g.target>1&&g.target<planner.thresholds.length;
      owner=value.owner;profession=value.profession;
      focus=valid(value.focus)?value.focus:null;
      parked=Object.fromEntries(Object.entries(value.parked??{}).filter(([skill,g])=>valid(g)&&g.skill===skill));
      completed=Number.isSafeInteger(value.completed)&&value.completed>=0?value.completed:0;
      visited=Object.fromEntries(Object.entries(value.visited??{}).filter(([skill,n])=>
        data.skills.includes(skill)&&Number.isSafeInteger(n)&&n>=0&&n<=completed));
      alternatives=Array.isArray(value.alternatives)?value.alternatives.slice(0,3):[];
    }
    return {owner,profession,focus,parked,completed,visited,alternatives};
  }
  const stalled=(p,goal)=>goal?.development&&goal.progressTick!=null&&
    (p.lastTick-goal.progressTick)*data.tickMs/1000>Math.max(1800,Math.min(7200,(goal.projectSeconds??1800)*2));
  return {chooseGoal,status,observe,reset,runtime,stalled,resumeReady};
}
