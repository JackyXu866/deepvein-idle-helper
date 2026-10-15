import {autoUsableMaterial} from './professions.js';
import {foodEffects} from './supplies.js';

// Ordinary and rare crops share a pantry reserve, but recipe demands keep
// their exact quality IDs. Growing crops count only as future supply.
export function cropReserve(data,p,job,level) {
  const itemId=job.output.itemId,item=data.items[itemId];
  if(data.jobs.some(j=>j.skill==='herblore'&&j.inputs.some(i=>i.itemId===itemId)))return 500;
  if(!item?.heals)return 0;
  const effects=foodEffects(data,itemId);
  const replaced=data.jobs.some(j=>{
    if(!j.grow||j.id===job.id||j.levelReq>level)return false;
    const other=data.items[j.output.itemId],buff=foodEffects(data,j.output.itemId);
    return other?.heals>=item.heals&&buff.fedTicks>=effects.fedTicks&&buff.rootedTicks>=effects.rootedTicks&&
      (other.heals>item.heals||buff.fedTicks>effects.fedTicks||buff.rootedTicks>effects.rootedTicks);
  });
  if(replaced)return 0;
  const capacity=28+Math.max(0,p.perks?.pockets??0);
  const carry=p.foodPerTrip===-1?capacity:p.foodPerTrip===-2?Math.max(1,capacity-1):p.foodPerTrip??20;
  return Math.max(500,carry*3);
}

export function farmingStocks(data,p,level,goal=null) {
  const base=id=>id%data.plusScale%data.rarityScale,stock={...p.bank};
  for(const i of p.pack)stock[i.itemId]=(stock[i.itemId]??0)+i.qty;
  for(const [id,qty]of Object.entries(p.overflow??{}))stock[id]=(stock[id]??0)+qty;
  return data.jobs.filter(j=>j.grow&&j.levelReq<=level).map(job=>{
    const itemId=job.output.itemId,future={};
    for(const plot of Object.values(p.plots??{}))if(base(plot.seedItemId)===job.inputs[0].itemId) {
      const id=itemId+Math.floor(plot.seedItemId%data.plusScale/data.rarityScale)*data.rarityScale;
      future[id]=(future[id]??0)+3; // Minimum confirmed native yield per field.
    }
    const demands=Object.entries(goal?.budget?.items??{}).filter(([id])=>base(+id)===itemId);
    const total=Object.entries(stock).reduce((n,[id,qty])=>n+(autoUsableMaterial(data,+id)&&base(+id)===itemId?qty:0),0);
    const target=Math.max(cropReserve(data,p,job,level),demands.reduce((n,[,qty])=>n+qty,0));
    const plannedMissing=demands.reduce((n,[id,qty])=>n+Math.max(0,qty-(stock[id]??0)),0);
    const plannedUncovered=demands.reduce((n,[id,qty])=>n+Math.max(0,qty-(stock[id]??0)-(future[id]??0)),0);
    const missing=Math.max(plannedUncovered,target-total-Object.values(future).reduce((a,b)=>a+b,0));
    return {job,total,target,plannedMissing,plannedUncovered,missing,short:Math.max(plannedMissing,target-total)};
  }).filter(row=>row.short>0).sort((a,b)=>
    Number(b.missing>0)-Number(a.missing>0)||Number(b.plannedUncovered>0)-Number(a.plannedUncovered>0)||
    b.missing/b.target-a.missing/a.target||b.short/b.target-a.short/a.target);
}
