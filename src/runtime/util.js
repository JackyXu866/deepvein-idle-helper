// Protocol and prediction evidence: research/world-boss-mechanics.md.
export const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
export {distance} from '../planner/items.js';
import {action as step, waiting} from '../planner/result.js';
export const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
export const wait=reason=>waiting('世界 Boss',reason);
export const action=(intent,reason)=>step(intent,'世界 Boss',reason);
export const point=p=>Number.isInteger(p?.x)&&Number.isInteger(p?.y);
