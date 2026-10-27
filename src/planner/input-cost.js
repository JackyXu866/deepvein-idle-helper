// What getting an input costs, by the cheapest way, as time:
// - stock: what it would sell for, as the time the gold job takes to earn it;
// - buying: the ask as time, plus a bank round trip;
// - gathering or crafting it (recursively, inputs by this same rule): the
//   work time, less the XP it earns when the profession trains that skill
//   (that time is not lost; it is credited at the skill's best rate).
// A recipe is chosen by (its XP + the credited input XP) / (its time + the
// time to get its inputs). Quests and item targets credit nothing: they are
// finished fast, buying cheap inputs rather than gathering at length.
import {goldToSeconds} from './gold.js';
import {autoUsableMaterial, craftRecipe} from './quality.js';
import {bankTripSeconds, baseId, rarityOf, stockMap} from './items.js';
import {perAction} from './rates.js';

const NONE={seconds:0,xp:0,effective:0,source:null};
const UNREACHABLE={seconds:Infinity,xp:0,effective:Infinity,source:null};

export function createInputCost(data,planner) {
  // One decision's state: the stock still unspent, the trained skills, and
  // the per-skill XP rates (memoised). buyOnly: inputs only from stock or
  // the market (for work that cannot gather on the way, such as a potion brew).
  // trained: the skills whose XP counts, when not the profession's.
  function context(p,{style=planner.styleHint??'magic',stock,credit=true,trained=null,grow=null,buyOnly=false}={}) {
    return {p,lv:planner.levels(p),stock:stock??stockMap(p),grow,buyOnly,rates:new Map(),coinRate:planner.coinRate?.(p)??0,
      trained:new Set(!credit?[]:trained??planner.trainedSkills?.(style)??[]),
      trip:bankTripSeconds(data,p)};
  }
  // XP per second of the best unlocked work in a skill (what its XP is worth).
  function skillRate(ctx,skill) {
    if(!ctx.rates.has(skill))ctx.rates.set(skill,Math.max(0,...data.jobs.filter(j=>j.skill===skill&&!j.grow&&
      ctx.lv[skill]>=j.levelReq&&data.sites.some(s=>s.jobIds.includes(j.id)))
      .map(j=>{const e=planner.estimateWork(ctx.p,j,ctx.lv);return e.seconds>0?e.xp/e.seconds:0;})));
    return ctx.rates.get(skill);
  }
  const credited=(ctx,skill,xp)=>ctx.trained.has(skill)&&xp>0&&skillRate(ctx,skill)>0?xp:0;
  const creditSeconds=(ctx,skill,xp)=>{const n=credited(ctx,skill,xp);return n?n/skillRate(ctx,skill):0;};
  // `runs` attempts of `job`, inputs included.
  function work(ctx,job,runs,trail) {
    const e=planner.estimateWork(ctx.p,job,ctx.lv);
    let seconds=runs*e.seconds,xp=credited(ctx,job.skill,runs*e.xp);
    let effective=Math.max(0,seconds-creditSeconds(ctx,job.skill,runs*e.xp));
    for(const input of job.inputs) {
      const part=acquire(ctx,input.itemId,input.qty*runs,trail);
      seconds+=part.seconds;xp+=part.xp;effective+=part.effective;
    }
    return {seconds,xp,effective,e};
  }
  // Producing `qty` of `id`: each recipe that makes it (that quality's recipe
  // for a quality item), a farm crop through the planner's hook, a monster or
  // bonus drop as a rough guess. Stock is spent only by the chosen way.
  function produce(ctx,id,qty,trail) {
    const tier=rarityOf(data,id),base=baseId(data,id),options=[];
    const makers=data.jobs.filter(j=>j.output.itemId===base&&ctx.lv[j.skill]>=j.levelReq&&(tier===0||j.inputs.length&&!j.grow));
    for(const original of makers) {
      if(original.grow) {
        const unit=ctx.grow?.(original,trail);
        if(Number.isFinite(unit))options.push({seconds:unit*qty,xp:0,effective:unit*qty,source:'grow',stock:ctx.stock});
        continue;
      }
      const job=tier>0?craftRecipe(data,original,tier):original;if(!job)continue;
      const saved=ctx.stock;ctx.stock={...saved};
      const probe=planner.estimateWork(ctx.p,job,ctx.lv),runs=qty/Math.max(1e-9,probe.commonOutput);
      const made=work(ctx,job,runs,trail);
      options.push({...made,source:job.inputs.length?'craft':'gather',stock:ctx.stock,job});
      ctx.stock=saved;
    }
    if(!makers.length&&tier===0) {
      // A monster drop: the fight's real time per drop (food included), as the
      // fight that gets it runs.
      if(data.monsters.some(m=>m.drop===id)) {
        const unit=planner.dropSeconds?.(ctx.p,id)??Infinity;
        if(Number.isFinite(unit))options.push({seconds:unit*qty,xp:0,effective:unit*qty,source:'drop',stock:ctx.stock});
      }
      else {
        const bonus=data.jobs.filter(j=>j.bonus?.itemId===id&&j.bonus.chance>0&&ctx.lv[j.skill]>=j.levelReq)
          .map(j=>perAction(planner.estimateWork(ctx.p,j,ctx.lv))/j.bonus.chance);
        const unit=bonus.length?Math.min(...bonus):3600;
        options.push({seconds:unit*qty,xp:0,effective:unit*qty,source:'bonus',stock:ctx.stock});
      }
    }
    return options.sort((a,b)=>a.effective-b.effective)[0]??null;
  }
  // `qty` of `id`: stock first (at its sale value), then the cheaper of buying
  // and producing the rest.
  function acquire(ctx,id,qty,trail=[]) {
    if(!(qty>0))return NONE;
    if(trail.includes(id)||!autoUsableMaterial(data,id))return UNREACHABLE;
    const p=ctx.p,used=Math.min(qty,Math.max(0,ctx.stock[id]??0));
    if(used>0)ctx.stock={...ctx.stock,[id]:ctx.stock[id]-used};
    // Getting `n` more: the cheaper of buying and producing.
    const fresh=n=>{
      const count=Math.ceil(n),price=(ctx.prices?.[id]??planner.marketBuyPrice?.(p,id,count))??Infinity;
      const bought=goldToSeconds(price*count,ctx.coinRate)+ctx.trip;
      const made=id<data.plusScale&&!ctx.buyOnly?produce(ctx,id,n,[...trail,id]):null;
      if(made&&made.effective<bought)return made;
      return Number.isFinite(bought)?{seconds:bought,xp:0,effective:bought,source:'buy',gold:price*count,stock:ctx.stock}:null;
    };
    // Stock costs what using it gives up: its sale value, but never more than
    // getting it again (raw materials are kept, not sold).
    let held=0;
    if(used>0) {
      const saved=ctx.stock,sale=goldToSeconds(used*planner.saleValue(p,id,Math.ceil(used)),ctx.coinRate);
      held=sale>0?Math.min(sale,fresh(used)?.effective??Infinity):0;ctx.stock=saved;
    }
    const rest=qty-used;
    if(rest<=0)return {seconds:held,xp:0,effective:held,source:'stock'};
    const got=fresh(rest);
    if(!got)return UNREACHABLE;
    ctx.stock=got.stock;
    return {seconds:held+got.seconds,xp:got.xp,effective:held+got.effective,source:got.source,...(got.gold?{gold:got.gold}:{})};
  }
  // The one make-or-buy verdict, which every buy step acts on: buying `qty`
  // of `id` (at `price` a unit, e.g. the live ask, else the market's) against
  // producing it, by the rule recipes are rated by: the price as time at the
  // gold rate plus a bank trip, against the making time less the XP it earns
  // in trained skills. No bias, no horizon.
  function decide(p,id,qty,{price=null,...options}={}) {
    const ctx=context(p,{stock:{},...options});
    if(price!=null)ctx.prices={[id]:price};
    const got=acquire(ctx,id,Math.max(1,qty),options.trail??[]);
    return {buy:got.source==='buy',source:got.source,seconds:got.effective};
  }
  // The job that produces `id` the cheapest way by this same rule (the
  // recipe or gathering job, at the item's quality); null for a drop or crop.
  // need() and the route estimate both produce with it.
  function producer(p,id,qty,options={}) {
    const ctx=context(p,{stock:{},...options});
    return produce(ctx,id,Math.max(1,qty),[...(options.trail??[]),id])?.job??null;
  }
  // Effective seconds for one unit of `id` when `qty` are needed (no stock).
  const unitSeconds=(p,id,qty=1,options={})=>
    acquire(context(p,{stock:{},...options}),id,Math.max(1,qty),options.trail??[]).effective/Math.max(1,qty);
  // `n` crafts of `job` with its inputs got the cheapest way: its own XP plus
  // the credited input XP, and the time including getting the inputs.
  function recipe(p,job,n,options={}) {
    const ctx=context(p,options),made=work(ctx,job,n,[job.output.itemId]);
    return {xp:made.e.xp*n+made.xp-credited(ctx,job.skill,n*made.e.xp),seconds:made.seconds};
  }
  // Making `qty` of `job`'s output with that recipe, inputs the cheapest way.
  function make(p,job,qty,options={}) {
    const ctx=context(p,options),e=planner.estimateWork(p,job,ctx.lv);
    return work(ctx,job,qty/Math.max(1e-9,e.commonOutput),[job.output.itemId]);
  }
  return {context,acquire,decide,producer,unitSeconds,recipe,make,skillRate};
}
