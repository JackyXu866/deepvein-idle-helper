// Measurement keys: telemetry records rates under these, the engine simulates
// under them and the planner looks them up, so all three must build them alike.
export const COMBAT_SKILLS=['melee','ranged','magic','defence','hitpoints'];

export const jobKey=(jobId,rarity=0)=>`job:${jobId}${rarity?`:rarity:${rarity}`:''}`;
export const combatKey=monsterId=>`combat:${monsterId}`;

// The key of a route (the player's or a planned one); null for an errand or a
// growing crop, which are never measured.
export function routeKey(data,route,rarity=0) {
  if(!route||route.errand)return null;
  if(route.zoneId!=null) {
    const monsterId=data.zones.find(z=>z.id===route.zoneId)?.monsterId;
    return monsterId==null?null:combatKey(monsterId);
  }
  const job=data.jobs.find(j=>j.id===route.jobId);
  return job&&!job.grow?jobKey(job.id,rarity):null;
}

// Gear and levels a measurement was taken with; it only applies to the same.
export const equipmentKey=p=>JSON.stringify(Object.keys(p.equipment).sort().map(k=>[k,p.equipment[k]]));
export const levelsKey=(skills,levelOf)=>JSON.stringify(skills.map(s=>[s,levelOf(s)]));
// A measurement counts once it has three samples and a minute of work.
export const usableSample=m=>!!m&&m.samples>=3&&m.seconds-(m.travelSeconds??0)>=60;
