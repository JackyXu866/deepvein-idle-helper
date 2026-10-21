// Which pieces belong in which slot, and how long a piece is worn before it is
// outgrown. Every gear choice (owned swaps, upgrades, the investment table,
// market buys) reads these.
import {gearRequirementOf, matchesProfessionWeapon} from './professions.js';
import {toolSlotFor} from './rates.js';

// A piece is valued for at most 30 days of use (until outgrown, if sooner).
export const USE_CAP_SECONDS=30*86400;
export const COMBAT_SLOTS=['weapon','helmet','body','legs','shield','ring','amulet'];
// A two-handed weapon, or the two-handed profession, leaves the shield empty.
export const shieldless=(profession,weapon)=>profession==='melee_twohand'||!!weapon?.twoHanded;
// The slots that serve a skill: every combat slot for an attack style (no
// shield when two-handed), else the skill's tool slot.
export function slotsFor(data,skill,{combat,profession,weapon}) {
  if(combat)return COMBAT_SLOTS.filter(slot=>slot!=='shield'||!shieldless(profession,weapon));
  const tool=toolSlotFor(data,skill);
  return tool?[tool]:[];
}
// A piece fits a slot for this skill: the right slot, the profession's weapon,
// and no other combat style's gear (tools have no style).
export const fitsSlot=(g,slot,skill,profession)=>!!g&&g.slot===slot&&
  (slot!=='weapon'||matchesProfessionWeapon(g,profession))&&(!g.style||g.style===skill);

// Seconds until a piece is outgrown: the XP to the next wear level in its line
// (same slot, style and needs) at the rate it is used, within [30 min, 30 days].
// The cap applies to the top of a line, to pieces without a wear skill, and
// when the rate given is for another skill than the one the piece needs.
export function useSeconds(data,planner,p,id,slot,rate,skill=null) {
  const r=gearRequirementOf(data,id),g=planner.equipmentStats(id);
  if(!r||r.skill==='none'||!(rate>0)||skill!=null&&r.skill!==skill)return USE_CAP_SECONDS;
  const next=data.gear.filter(o=>o.slot===slot&&(o.style??null)===(g?.style??null)&&o.needs===g?.needs)
    .map(o=>gearRequirementOf(data,o.itemId)).filter(o=>o.skill===r.skill&&o.level>r.level).map(o=>o.level).sort((a,b)=>a-b)[0];
  if(next==null)return USE_CAP_SECONDS;
  return Math.min(USE_CAP_SECONDS,Math.max(1800,planner.xpTo(p,r.skill,next)/rate));
}
