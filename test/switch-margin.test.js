import test from 'node:test';
import assert from 'node:assert/strict';
import {SWITCH_MARGIN, outscores} from '../src/planner/strategy.js';

test('the current task is left only for one more than 10% better', () => {
  assert.equal(SWITCH_MARGIN, 1.1);
  assert.equal(outscores(109, 100), false, '9% better: stay');
  assert.equal(outscores(110, 100), false, 'exactly 10%: stay');
  assert.equal(outscores(111, 100), true, '11% better: switch');
  assert.equal(outscores(1, 0), true, 'anything beats a task that no longer pays');
});
