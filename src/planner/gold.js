// Gold as time. Every spend (enhancing, gear, house points, market buys) is
// converted to the seconds the best gold job needs to earn it, at the one gold
// rate (planner.coinRate), and every improvement to the seconds it saves over
// the time it will actually be used. Spend only when the time saved beats the
// time paid by a margin.
export const PAYBACK_MARGIN=1.2;

// Unknown or zero gold rate: gold cannot be earned, so any price is endless.
export const goldToSeconds=(gold,rate)=>gold>0?(rate>0?gold/rate:Infinity):0;
export const secondsToGold=(seconds,rate)=>seconds>0&&rate>0?seconds*rate:0;

// Seconds saved over `useSeconds` of play when progress per second rises
// from `before` to `after`: the same progress then takes before/after as long.
export const secondsSaved=(before,after,useSeconds)=>
  before>0&&after>before&&useSeconds>0?useSeconds*(1-before/after):0;

// The one test every spend and sacrifice passes (gear, enhancing, house,
// buff food, a dropped load): the time it saves beats the time it costs by
// the margin.
export const pays=(saved,paid)=>Number.isFinite(paid)&&saved>0&&saved>=paid*PAYBACK_MARGIN;
// The order improvements across slots get the gold in: the most saved per
// unit paid first (not the cheapest, nor the largest), then the larger net.
// One slot's options are alternatives and its pick is by net; the slots'
// picks then queue by this, and a lower one waits for those above it.
const returnOf=r=>r.paid>0?r.saved/r.paid:Infinity;
export const byReturn=(a,b)=>returnOf(b)-returnOf(a)||b.net-a.net;
export function payback({gold=0,seconds=0,credit=0,coinRate,before,after,useSeconds}) {
  const paid=Math.max(0,seconds-credit)+goldToSeconds(gold,coinRate);
  const saved=secondsSaved(before,after,useSeconds);
  return {paid,saved,net:saved-paid,worth:pays(saved,paid)};
}
// The same rule for an improvement that earns more gold instead of saving
// time (a hoe: more crops per harvest): `before`/`after` are gold per second,
// and what it saves is the extra gold over its use, as time at the gold rate.
export function incomePayback({gold=0,seconds=0,coinRate,before,after,useSeconds}) {
  const paid=Math.max(0,seconds)+goldToSeconds(gold,coinRate);
  const saved=coinRate>0&&after>before&&useSeconds>0?(after-before)*useSeconds/coinRate:0;
  return {paid,saved,net:saved-paid,worth:pays(saved,paid)};
}
// The most worth paying for something that saves `savedGold` worth of time:
// the payback rule above, solved for the price.
export const maxPrice=savedGold=>savedGold>0?savedGold/PAYBACK_MARGIN:0;
