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

export function payback({gold=0,seconds=0,credit=0,coinRate,before,after,useSeconds}) {
  const paid=Math.max(0,seconds-credit)+goldToSeconds(gold,coinRate);
  const saved=secondsSaved(before,after,useSeconds);
  return {paid,saved,net:saved-paid,worth:Number.isFinite(paid)&&saved>0&&saved>=paid*PAYBACK_MARGIN};
}
// The most worth paying for something that saves `savedGold` worth of time:
// the payback rule above, solved for the price.
export const maxPrice=savedGold=>savedGold>0?savedGold/PAYBACK_MARGIN:0;
