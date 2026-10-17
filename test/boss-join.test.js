import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBossJoinControl} from '../src/ui/boss-join.js';

// A minimal DOM: elements by selector, each shown unless told otherwise.
function page({pill = null, run = null} = {}) {
  const element = (extra) => ({isConnected: true, hidden: false, disabled: false, closest: () => null,
    getClientRects: () => [1], ...extra});
  const nodes = {
    '[data-boss-pill]': pill && element({querySelector: s => s === '.boss-pill-join' ? {textContent: pill} : null}),
    '[data-boss-run]': run && element({textContent: run}),
  };
  return {querySelector: s => nodes[s] ?? null, nodes};
}

test('the top bar "加入" is the game\'s join, even before a nearby Boss is seen', () => {
  const doc = page({pill: ' 加入 '});
  assert.equal(nativeBossJoinControl(doc), doc.nodes['[data-boss-pill]']);
  assert.ok(nativeBossJoinControl(page({pill: 'Join'})));
  assert.equal(nativeBossJoinControl(page({pill: '查看'})), null, 'already in: nothing to click');
});

test('the run/attack button is used too, in either language', () => {
  for (const text of ['攻击', 'Attack', '跑过去', 'Run to it', '前往', '赶过去'])
    assert.ok(nativeBossJoinControl(page({run: text})), text);
  assert.equal(nativeBossJoinControl(page({run: '离开'})), null);
  const hidden = page({pill: '加入'});
  hidden.nodes['[data-boss-pill]'].hidden = true;
  assert.equal(nativeBossJoinControl(hidden), null, 'hidden controls are not clicked');
});
