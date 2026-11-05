// The game formulas' inputs for one job or fight, with a given set of
// equipment. strategy.estimateWork calibrates these with measurements; gear
// comparisons use the formula on both sides of a swap.
import {professionSkill} from './professions.js';
import {combatDrops, combatEstimate, workEstimate} from './estimates.js';
import {rarityFactor, toolSlotFor} from './rarity.js';

export {toolSlotFor};

// Tool bonus, perks and the quality factor (rarity.js: tool and amulet luck,
// brews, mastery, house).
export function workInputs(data,planner,p,job,equipment=p.equipment,extra=0) {
  const tool=equipment?.[toolSlotFor(data,job.skill)];
  const rarity=rarityFactor(data,planner,p,job.skill,{equipment,extra});
  return {toolBonus:planner.equipmentStats(tool)?.bonus??0,quick:p.perks?.quick??0,hands:p.perks?.hands??0,
    luck:rarity.luck,rarityFactor:rarity.factor};
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
export function combatStats(data,planner,p,profession,equipment=p.equipment,lv=planner.levels(p),extra=0) {
  const style=professionSkill(profession),weapon=planner.equipmentStats(equipment.weapon);
  const shieldless=profession==='melee_twohand'||weapon?.twoHanded;
  const gear=Object.entries(equipment).filter(([slot,id])=>Number.isFinite(id)&&(slot!=='shield'||!shieldless))
    .map(([,id])=>planner.equipmentStats(id)).filter(Boolean);
  const sum=k=>gear.reduce((n,g)=>n+(k==='defence'||!g.style||g.style===style?1:-1)*(g[k]??0),0);
  const rarity=rarityFactor(data,planner,p,style,{equipment,extra});
  return {style,level:lv[style],accuracy:sum('accuracy'),strength:sum('strength'),defence:sum('defence'),
    defenceLevel:lv.defence,speed:weapon?.speed??5,twoHanded:weapon?.twoHanded,luck:rarity.luck,
    rarity:{factor:rarity.factor,dropFactor:rarity.dropFactor}};
}
// A fight the character survives without fuss: the monster hits under a third
// of base hitpoints, and full health lasts at least six average enemy hits.
export const combatSafe=(lv,stats,monster)=>monster.maxHit<lv.hitpoints/3&&
  lv.hitpoints/((10+monster.attack)/(20+monster.attack+lv.defence+stats.defence)*(1+monster.maxHit)/2)>=6;

// Gold per second the rarer qualities add when the bonus sum rises by `extra`
// (a hunter brew, a rare-find rank) on this work: a gathering job's output
// or a monster's drops, every quality at its sale value (the income ranking's
// value), the commons it replaces taken off. Crafting rolls no quality: 0.
export function qualityGain(data,planner,p,{job=null,monster=null,profession='magic'},extra) {
  const value=(id,qty)=>qty>0?(planner.saleValue?.(p,id,Math.max(1,Math.round(qty)))??0)*qty:0;
  if(job) {
    if(job.inputs.length||job.grow||job.output.itemId===data.coinId)return 0;
    const lv=planner.levels(p),at=x=>workEstimate(data,job,lv[job.skill],workInputs(data,planner,p,job,p.equipment,x));
    const worth=e=>e.tierOutput.reduce((n,q,i)=>n+value(job.output.itemId+i*data.rarityScale,q),0);
    const before=at(0),after=at(extra);
    return before.seconds>0?(worth(after)-worth(before))/before.seconds:0;
  }
  if(monster) {
    const at=x=>combatStats(data,planner,p,profession,p.equipment,planner.levels(p),x);
    const e=combatEstimate(data,monster,at(0));
    if(!(e.seconds>0)||!Number.isFinite(e.seconds))return 0;
    const worth=drops=>Object.entries(drops).reduce((n,[id,q])=>Number(id)===data.shardId?n:n+value(Number(id),q),0);
    return (worth(combatDrops(data,monster,at(extra).rarity))-worth(e.drops))/e.seconds;
  }
  return 0;
}
