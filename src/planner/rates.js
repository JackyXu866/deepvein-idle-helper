// The game formulas' inputs for one job or fight, with a given set of
// equipment: every rate the planner uses (strategy.js adds only the death check).
import {professionSkill} from './professions.js';
import {combatEstimate, workEstimate} from './estimates.js';
import {rarityFactor, toolSlotFor} from './rarity.js';
import {houseBonus} from './house-bonus.js';
import {WORK_PAGE, pageRanks} from './mastery-pages.js';
import {GATHER_SKILLS, masteryLift} from '../engine/mastery-rules.js';
import {brewPower} from './supplies.js';

export {toolSlotFor};

// The game's XP multiplier on every action (client JX and fm for work, Xpo
// for combat): the XP-gain mastery (+0.5% a rank), the elixir (+10%), the
// Vein Blessing (+5%), the guild bonus, and for work with no inputs the
// gatherer's brew (+10%), for mining, fishing, woodcutting and farming the
// packed (+5%) and hearty (+10%) lunches, and for work each piece of a boss
// set whose skills include it (+2%, +2% more for all three). The town event
// and the hot-skill window are left out: they last hours, and hot-follow
// weighs the window itself. (Without it, every rate measured in the game
// was about 1.5x the formula: the XP mastery alone is +31% at 62 ranks.)
const LUNCH_SKILLS=['mining','fishing','woodcutting','farming'];
const BOSS_SETS=[{items:[741,742,743],skills:['mining','smithing']},{items:[744,745,746],skills:['fishing','cooking']},
  {items:[747,748,749],skills:['woodcutting','fletching']}];
function bossSetXp(data,equipment,skill) {
  const pieces=['helmet','body','legs'].filter(slot=>{const id=equipment?.[slot];
    return Number.isFinite(id)&&BOSS_SETS.some(set=>set.items.includes(id%data.rarityScale)&&set.skills.includes(skill));}).length;
  return pieces*.02+(pieces===3?.02:0);
}
export function xpLift(data,p,skill,{work=false,gathering=false}={}) {
  const brew=kind=>brewPower(data,p,kind);
  let lift=(1+.1*brew('elixir'))*((p.brews?.blessing??0)>p.lastTick?1.05:1)*(1+(p.guildBonus??0))*
    masteryLift(pageRanks(p,WORK_PAGE),'xp');
  if(gathering)lift*=1+.1*brew('gatherer');
  if(gathering&&LUNCH_SKILLS.includes(skill))lift*=(1+.05*brew('packed-lunch'))*(1+.1*brew('hearty-lunch'));
  return work?lift*(1+bossSetXp(data,p.equipment,skill)):lift;
}

// Tool bonus, perks, the house room and mastery speeding the skill (the work
// page's ranks), and the quality factor (rarity.js: tool and amulet luck,
// brews, mastery, house).
// `quality`: a number added to the rare-find bonus sum, or {extra, luck} (rarity.js).
const qualityOf=q=>typeof q==='number'?{extra:q}:q??{};
export function workInputs(data,planner,p,job,equipment=p.equipment,quality=0) {
  const tool=equipment?.[toolSlotFor(data,job.skill)];
  const rarity=rarityFactor(data,planner,p,job.skill,{equipment,...qualityOf(quality)});
  return {toolBonus:planner.equipmentStats(tool)?.bonus??0,quick:p.perks?.quick??0,hands:p.perks?.hands??0,
    home:houseBonus(data,p,['gatherSpeed','craftSpeed'],job.skill),
    mastery:masteryLift(pageRanks(p,WORK_PAGE),GATHER_SKILLS.includes(job.skill)?'gather':'craft'),
    luck:rarity.luck,rarityFactor:rarity.factor,
    xpLift:xpLift(data,{...p,equipment},job.skill,{work:true,gathering:!job.inputs.length})};
}
export const formulaWork=(data,planner,p,job,lv=planner.levels(p),equipment=p.equipment)=>
  workEstimate(data,job,lv[job.skill],workInputs(data,planner,p,job,equipment));
// Seconds per finished action, failures included.
export const perAction=e=>e.seconds/Math.max(.01,e.success);

// The combat skill a weapon trains.
export const weaponStyle=weapon=>weapon?.magic?'magic':weapon?.ranged?'ranged':'melee';

// Combat stats with this equipment: gear sums signed by style (a piece of
// another style counts against; defence always counts), the weapon's speed and
// the quality factor of drops. A two-handed weapon or profession leaves the shield off.
export function combatStats(data,planner,p,profession,equipment=p.equipment,lv=planner.levels(p),quality=0) {
  const style=professionSkill(profession),weapon=planner.equipmentStats(equipment.weapon);
  const shieldless=profession==='melee_twohand'||weapon?.twoHanded;
  const gear=Object.entries(equipment).filter(([slot,id])=>Number.isFinite(id)&&(slot!=='shield'||!shieldless))
    .map(([,id])=>planner.equipmentStats(id)).filter(Boolean);
  const sum=k=>gear.reduce((n,g)=>n+(k==='defence'||!g.style||g.style===style?1:-1)*(g[k]??0),0);
  const rarity=rarityFactor(data,planner,p,style,{equipment,...qualityOf(quality)}),ranks=pageRanks(p,WORK_PAGE);
  return {style,level:lv[style],accuracy:sum('accuracy'),strength:sum('strength'),defence:sum('defence'),
    defenceLevel:lv.defence,speed:weapon?.speed??5,twoHanded:weapon?.twoHanded,luck:rarity.luck,xpLift:xpLift(data,p,style),
    damageLift:(1+houseBonus(data,p,'dmg',style))*masteryLift(ranks,'maxhit'),accuracyLift:masteryLift(ranks,'accuracy'),
    rarity:{factor:rarity.factor,dropFactor:rarity.dropFactor}};
}
// A fight the character survives without fuss: the monster hits under a third
// of base hitpoints, and full health lasts at least six average enemy hits.
export const combatSafe=(lv,stats,monster)=>monster.maxHit<lv.hitpoints/3&&
  lv.hitpoints/((10+monster.attack)/(20+monster.attack+lv.defence+stats.defence)*(1+monster.maxHit)/2)>=6;

// Gold per second of one work by the formula, at sale values (the income
// ranking's value): a job's output of every quality (a coin stall's coins), or
// a monster's coins and drops (shards left out). Crafting counts its output
// only: comparisons of the same work's speed or odds. `quality` as workInputs
// takes it; `equipment` to rate other gear.
export function goldRate(data,planner,p,{job=null,monster=null,profession='magic',equipment=p.equipment},quality=0) {
  const value=(id,qty)=>qty>0?(planner.saleValue?.(p,id,Math.max(1,Math.round(qty)))??0)*qty:0;
  if(job) {
    if(job.grow)return 0;
    const e=workEstimate(data,job,planner.levels(p)[job.skill],workInputs(data,planner,p,job,equipment,quality));
    if(!(e.seconds>0))return 0;
    const worth=job.output.itemId===data.coinId?e.coins:job.inputs.length?value(job.output.itemId,e.output):
      e.tierOutput.reduce((n,q,i)=>n+value(job.output.itemId+i*data.rarityScale,q),0);
    return worth/e.seconds;
  }
  if(monster) {
    const e=combatEstimate(data,monster,combatStats(data,planner,p,profession,equipment,planner.levels(p),quality));
    if(!(e.seconds>0)||!Number.isFinite(e.seconds))return 0;
    return Object.entries(e.drops).reduce((n,[id,q])=>Number(id)===data.shardId?n:n+value(Number(id),q),e.coins)/e.seconds;
  }
  return 0;
}
// Gold per second the rarer qualities add when the bonus sum rises by `extra`
// (a hunter brew, a rare-find rank); crafting rolls no quality: 0.
export const qualityGain=(data,planner,p,work,extra)=>goldRate(data,planner,p,work,extra)-goldRate(data,planner,p,work,0);
// Gold per second the gear's luck (amulet, tool quality) adds to this work:
// the same work with that luck against none.
export const luckGold=(data,planner,p,work)=>goldRate(data,planner,p,work)-goldRate(data,planner,p,work,{luck:0});
