// The game formulas' inputs for one job or fight, with a given set of
// equipment. strategy.estimateWork calibrates these with measurements; gear
// comparisons use the formula on both sides of a swap.
import {professionSkill} from './professions.js';
import {workEstimate} from './estimates.js';
import {rarityOf} from './items.js';

// The equipment slot whose tool serves a skill (pickaxe for mining, ...).
export const toolSlotFor=(data,skill)=>Object.keys(data.toolSkills).find(s=>data.toolSkills[s]===skill)??null;

// Tool bonus, perks and quality luck (the tool's quality plus the amulet).
export function workInputs(data,planner,p,job,equipment=p.equipment) {
  const tool=equipment?.[toolSlotFor(data,job.skill)];
  return {toolBonus:planner.equipmentStats(tool)?.bonus??0,quick:p.perks?.quick??0,hands:p.perks?.hands??0,
    luck:(data.toolLuck[rarityOf(data,tool??0)]??0)+(planner.equipmentStats(equipment?.amulet)?.luck??0)};
}
export const formulaWork=(data,planner,p,job,lv=planner.levels(p),equipment=p.equipment)=>
  workEstimate(data,job,lv[job.skill],workInputs(data,planner,p,job,equipment));
// Seconds per finished action, failures included.
export const perAction=e=>e.seconds/Math.max(.01,e.success);

// The combat skill a weapon trains.
export const weaponStyle=weapon=>weapon?.magic?'magic':weapon?.ranged?'ranged':'melee';

// Combat stats with this equipment: gear sums signed by style (a piece of
// another style counts against; defence always counts), the weapon's speed and
// the amulet's luck. A two-handed weapon or profession leaves the shield off.
export function combatStats(data,planner,p,profession,equipment=p.equipment,lv=planner.levels(p)) {
  const style=professionSkill(profession),weapon=planner.equipmentStats(equipment.weapon);
  const shieldless=profession==='melee_twohand'||weapon?.twoHanded;
  const gear=Object.entries(equipment).filter(([slot,id])=>Number.isFinite(id)&&(slot!=='shield'||!shieldless))
    .map(([,id])=>planner.equipmentStats(id)).filter(Boolean);
  const sum=k=>gear.reduce((n,g)=>n+(k==='defence'||!g.style||g.style===style?1:-1)*(g[k]??0),0);
  return {style,level:lv[style],accuracy:sum('accuracy'),strength:sum('strength'),defence:sum('defence'),
    defenceLevel:lv.defence,speed:weapon?.speed??5,twoHanded:weapon?.twoHanded,luck:planner.equipmentStats(equipment.amulet)?.luck??0};
}
// A fight the character survives without fuss: the monster hits under a third
// of base hitpoints, and full health lasts at least six average enemy hits.
export const combatSafe=(lv,stats,monster)=>monster.maxHit<lv.hitpoints/3&&
  lv.hitpoints/((10+monster.attack)/(20+monster.attack+lv.defence+stats.defence)*(1+monster.maxHit)/2)>=6;
