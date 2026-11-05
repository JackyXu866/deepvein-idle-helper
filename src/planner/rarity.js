// Quality rolls (client 1.0.12xx Zg, p7/v7, m4, Gb, Da): every gathered
// output and monster drop rolls once against each quality's odds, scaled by
//   (1 + luck) × (1 + the sum of the bonuses)
// luck: the amulet, plus the tool's quality when gathering (a fight has no tool).
// Bonuses (they add): hunter brew +0.25 per power, Vein Blessing +0.1,
// rare-find mastery +0.5% per rank (the work page's ranks), and the lucky
// shrine (level × 1% × its rate; not on farming).
// A monster's bonus drop chance scales the same way, without the shrine.
// Left out: town events (the helper does not see them) and the hourly hot
// window (temporary; hot-follow chases it, and simulations cancel it).
// Every estimate, potion and mastery rank uses this one factor.
import {brewPower} from './supplies.js';
import {rarityOf} from './items.js';
import {WORK_PAGE, pageRanks} from './mastery-pages.js';
import {houseBonus} from './house-bonus.js';

export const HUNTER_PER_POWER=.25,BLESSING_RARE=.1,RARE_PER_RANK=.005;

// The equipment slot whose tool serves a skill (pickaxe for mining, ...).
export const toolSlotFor=(data,skill)=>Object.keys(data.toolSkills).find(s=>data.toolSkills[s]===skill)??null;

export const shrineBonus=(data,p)=>houseBonus(data,p,'rareChance');

// The factor for work in `skill` (a combat style for fights) with this
// equipment. `extra` adds to the bonus sum (what a brew or a rank would add);
// `luck`, when given, replaces the gear's luck (0: what the luck is worth).
// {luck, bonus, factor, dropFactor}: dropFactor scales a monster's bonus drop.
export function rarityFactor(data,planner,p,skill,{equipment=p?.equipment,extra=0,luck:fixed=null}={}) {
  const slot=toolSlotFor(data,skill),tool=slot?equipment?.[slot]:null;
  const luck=fixed??(planner.equipmentStats(equipment?.amulet)?.luck??0)+(tool!=null?data.toolLuck[rarityOf(data,tool)]??0:0);
  const blessing=(p?.brews?.blessing??0)>(p?.lastTick??Infinity)?BLESSING_RARE:0;
  const common=HUNTER_PER_POWER*brewPower(data,p??{},'hunter')+blessing+
    RARE_PER_RANK*(pageRanks(p,WORK_PAGE).rare??0)+extra;
  const bonus=common+(skill==='farming'?0:shrineBonus(data,p));
  return {luck,bonus,factor:(1+luck)*(1+bonus),dropFactor:(1+luck)*(1+common)};
}
