export const PROFESSIONS={magic:'法师',melee:'单手战士',melee_twohand:'双手战士',ranged:'短弓游侠',ranged_long:'长弓游侠'};

export const professionSkill=profession=>profession==='melee_twohand'?'melee':profession==='ranged_long'?'ranged':profession;
export const starterWeapon=profession=>({magic:152,melee:110,melee_twohand:390,ranged:140,ranged_long:146})[profession];

export function matchesProfessionWeapon(gear,profession) {
  if (!gear||gear.slot!=='weapon'||gear.needs!==professionSkill(profession)) return false;
  if (gear.needs==='melee') return !!gear.twoHanded===(profession==='melee_twohand');
  if (gear.needs==='ranged') return gear.speed===(profession==='ranged_long'?5:3);
  return true;
}


export const qualityMaterials=new WeakMap();
// Native Jt: coal and wild herbs stay plain; only quality-bearing inputs change.
// Legendary stock is player-controlled and is never an automatic recipe input.
export function autoUsableMaterial(data,itemId) {
  return Math.floor((itemId%data.plusScale)/data.rarityScale)<data.rarityMultipliers.length-1;
}

export function craftRecipe(data,job,tier=0) {
  if(!tier)return job;
  if(!Number.isInteger(tier)||tier<1||tier>4||!job?.inputs.length||job.grow||job.output.itemId===data.coinId)return null;
  if(!qualityMaterials.has(data))qualityMaterials.set(data,new Set([
    ...data.jobs.map(j=>j.output.itemId),...data.monsters.map(m=>m.drop),100,328,
    ...data.jobs.filter(j=>j.grow).map(j=>j.inputs[0].itemId)]));
  const materials=qualityMaterials.get(data),offset=tier*data.rarityScale;
  return {...job,rarity:tier,xp:Math.round(job.xp*data.rarityXp[tier]),
    inputs:job.inputs.map(i=>i.itemId!==5&&!(i.itemId>=201&&i.itemId<=207)&&materials.has(i.itemId)?
      {...i,itemId:i.itemId+offset}:i),output:{...job.output,itemId:job.output.itemId+offset}};
}
