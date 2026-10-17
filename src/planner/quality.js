// Item quality (common, uncommon, rare, epic, legendary): every rule about it
// lives here, so recipes, pairing, reserves, prices and sales agree.
import {COAL_ID, RARITY_NAMES, baseId, qualityIds, qualityPrefix, rarityOf} from './items.js';

export {RARITY_NAMES, qualityIds, qualityPrefix, rarityOf};

export const LEGENDARY=4;
// Qualities a plan may combine, rarest first: rarer sets give more XP and are
// worth more. Legendary stays with the player.
export const PAIR_TIERS=[3,2,1,0];

// Legendary stock is player-controlled and is never used automatically.
export function autoUsableMaterial(data,itemId) {
  return Math.floor((itemId%data.plusScale)/data.rarityScale)<data.rarityMultipliers.length-1;
}

// The qualities of one item the helper may use (legendary excluded).
export const usableQualities=(data,id)=>qualityIds(data,id).filter(q=>autoUsableMaterial(data,q));

// A recipe at one quality (client Jt): every quality-bearing input and the
// output take that quality; coal and wild herbs stay plain.
export const qualityMaterials=new WeakMap();
export function craftRecipe(data,job,tier=0) {
  if(!tier)return job;
  if(!Number.isInteger(tier)||tier<1||tier>4||!job?.inputs.length||job.grow||job.output.itemId===data.coinId)return null;
  if(!qualityMaterials.has(data))qualityMaterials.set(data,new Set([
    ...data.jobs.map(j=>j.output.itemId),...data.monsters.map(m=>m.drop),100,328,
    ...data.jobs.filter(j=>j.grow).map(j=>j.inputs[0].itemId)]));
  const materials=qualityMaterials.get(data),offset=tier*data.rarityScale;
  return {...job,rarity:tier,xp:Math.round(job.xp*data.rarityXp[tier]),
    inputs:job.inputs.map(i=>i.itemId!==COAL_ID&&!(i.itemId>=201&&i.itemId<=207)&&materials.has(i.itemId)?
      {...i,itemId:i.itemId+offset}:i),output:{...job.output,itemId:job.output.itemId+offset}};
}

// Complete input sets of a recipe that `count` (item id -> quantity) covers.
// Quality never mixes inside one set, so each quality is counted on its own.
export const setsAt=(recipe,count)=>recipe?.inputs.length?
  Math.min(...recipe.inputs.map(i=>Math.floor(Math.max(0,count(i.itemId))/i.qty))):0;
// Sets of `job` per usable quality, rarest first: [{tier, recipe, sets}].
export function setsByTier(data,job,count) {
  return PAIR_TIERS.map(tier=>({tier,recipe:craftRecipe(data,job,tier)}))
    .filter(r=>r.recipe).map(r=>({...r,sets:setsAt(r.recipe,count)}));
}

// Is this item made by a recipe (processed), rather than gathered, grown or dropped?
export const processed=(data,id)=>data.jobs.some(j=>j.output.itemId===baseId(data,id)&&j.inputs.length&&!j.grow);
