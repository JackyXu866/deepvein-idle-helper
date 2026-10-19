import test from 'node:test';
import assert from 'node:assert/strict';
import {keepGameActive} from '../src/ui/stay-active.js';

// A stand-in document whose real visibility lives on its prototype, as in browsers.
function page(hidden) {
  class Doc extends EventTarget {
    get hidden() { return this.realHidden; }
    get visibilityState() { return this.realHidden ? 'hidden' : 'visible'; }
  }
  const doc = new Doc();
  doc.realHidden = hidden;
  return {doc, win: new EventTarget()};
}

test('the game always sees a visible tab; the helper still reads the real state', () => {
  const {doc, win} = page(true);
  const visibility = keepGameActive(win, doc);
  assert.equal(doc.hidden, false, 'the game never sees hidden, so it never sends "away"');
  assert.equal(doc.visibilityState, 'visible');
  assert.equal(visibility.hidden(), true, 'the helper knows the tab is hidden');
  doc.realHidden = false;
  assert.equal(visibility.hidden(), false);
});

test('hide/show events reach the helper but not the game', () => {
  const {doc, win} = page(false);
  const visibility = keepGameActive(win, doc);
  let helper = 0, game = 0;
  visibility.onChange(() => helper++);
  win.addEventListener('visibilitychange', () => game++); // a listener after the capture one
  win.dispatchEvent(new Event('visibilitychange'));
  assert.equal(helper, 1);
  assert.equal(game, 0, 'the game does not learn the tab changed');
});
