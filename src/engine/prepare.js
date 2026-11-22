import {extractEngine} from './extract.js';
import {loadEngine} from './runtime.js';

// Worker request: extract the engine from client `source` (or reuse a cached
// `factory`), load and smoke-test it. Returns only cloneable fields; the
// factory text is returned after a fresh extraction so the page can cache it.
export function prepareEngine({id, source = null, factory = null}, parse) {
  let extracted = null;
  if (!factory) {
    extracted = extractEngine(source, parse);
    if (!extracted.ok) return {id, ok: false, error: '引擎提取未通过检查', problems: extracted.problems.slice(0, 8), stats: extracted.stats ?? null};
    factory = extracted.factory;
  }
  const status = loadEngine({id, factory});
  // `counts`: the simulation failed its smoke test but the engine's pure counts
  // (mastery points) work; the page keeps the factory for those.
  return {id, ok: status.ok, counts: !!status.counts, error: status.error, problems: extracted?.problems.slice(0, 8) ?? [],
    stats: extracted?.stats ?? null, factory: (status.ok || status.counts) && extracted ? factory : undefined};
}
