// The planner's market and economy hooks, wired the same way on the page and in
// the planning Worker. The economy and the potion setting are read on every call,
// so a recreated economy (after a data refresh) or a toggled setting applies at once.

// Storage the Worker may read and propose writes for; the page applies only these.
export const ENHANCEMENT_TRAINING_KEY='deepvein-enhancement-training-v1';
export const PLANNING_STORAGE_KEYS=['deepvein-market-v1',ENHANCEMENT_TRAINING_KEY];

const MARKET_HOOKS={marketSale:'sale',marketPurchase:'purchase',marketOpportunity:'opportunity',
  watchMarket:'watch',marketEquipment:'equipmentPurchase',marketFood:'foodPurchase',marketBuffFood:'buffFood',
  potionDose:'potionDose',marketAllowance:'purchaseAllowance',marketBuyPrice:'marketBuyPrice',
  marketSurplusValue:'surplusValue',watchPurchases:'watchPurchases',marketUnitValue:'unitValue',marketAsk:'askPrice',marketClosed:'closed'};

export function wirePlanner(planner,market,economy,potionRestock) {
  planner.maintenance=(...args)=>economy().maintenance(...args);
  for(const [name,method]of Object.entries(MARKET_HOOKS))planner[name]=(...args)=>market[method](...args);
  // Held stock is worth what it would sell for, whether or not the helper's
  // own sale settings sell it: using or burning it gives that up. Only what
  // cannot be sold at all costs nothing to use (planner.stockValue).
  planner.stockSold=(p,id)=>market.saleable(p,id);
  planner.restockPotion=(...args)=>potionRestock()?market.restockPotion(...args):null;
  planner.restockIngredient=(...args)=>potionRestock()?market.restockIngredient(...args):null;
  planner.potionStatus=(...args)=>potionRestock()?market.potionStatus(...args):
    {key:'procurement-off',message:'药水未喝：库存不足，自动补药已关闭'};
  planner.watchPotions=(p,itemIds)=>market.watchPotions(p,potionRestock()?itemIds:[]);
}

// Enhancement-training record; a failed write keeps the in-memory record.
export const enhancementStorage=storage=>({
  read:()=>{try {return JSON.parse(storage.getItem(ENHANCEMENT_TRAINING_KEY)||'null');}catch{return null;}},
  write:value=>{try {storage.setItem(ENHANCEMENT_TRAINING_KEY,JSON.stringify(value));}catch{}}
});
