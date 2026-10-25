import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

test('a recipe in a quality the held sets make is a gold candidate, valued at that quality', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar');
  const [copper, tin] = bar.inputs.map(i => i.itemId);
  const p = player(planner, {levels: {smithing: 10, mining: 10}, x: d.banks[0].x, y: d.banks[0].y,
    bank: {[copper + R]: 40, [tin + R]: 40}});
  const list = planner.candidates(p, 'melee', {});
  const rare = list.find(c => c.recipeId === bar.id && c.rarity === 1);
  assert.ok(rare, 'an uncommon bronze bar candidate');
  assert.equal(rare.output.itemId, bar.output.itemId + R);
  assert.deepEqual(rare.recipeRarities, {smithing: 1});
  planner.coinRate = () => 1;
  planner.marketUnitValue = (_p, id) => id === bar.output.itemId + R ? 400 : 0;
  const priced = planner.incomeChoices(p, [rare], 'melee')[0];
  assert.ok(priced.marketProceeds >= 400 * Math.min(rare.output.qty, 1), JSON.stringify(priced.marketProceeds));
  assert.deepEqual(priced.saleItems, [bar.output.itemId + R], 'sold as rare processed surplus');
});

test('a stock batch is charged for the held materials it uses: income is what making adds', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.watchMarket = () => {};
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar');
  const [copper, tin] = bar.inputs.map(i => i.itemId);
  const p = player(planner, {levels: {smithing: 10, mining: 10}, x: d.banks[0].x, y: d.banks[0].y,
    bank: {[copper + R]: 40, [tin + R]: 40}});
  const rare = planner.candidates(p, 'melee', {}).find(c => c.recipeId === bar.id && c.rarity === 1);
  assert.equal(rare.estimate.owned[copper + R], rare.batch, 'the held uncommon ore it uses');
  planner.coinRate = () => 1;
  const price = {[bar.output.itemId + R]: 400, [copper + R]: 150, [tin + R]: 150};
  planner.marketUnitValue = (_p, id) => price[id] ?? 0;
  const priced = planner.incomeChoices(p, [rare], 'melee')[0];
  const expected = (priced.marketProceeds - priced.inputValue + rare.estimate.coins) / rare.estimate.seconds;
  assert.ok(priced.inputValue >= 300 * rare.batch - 1e-6, JSON.stringify(priced.inputValue));
  assert.ok(Math.abs(priced.rate.coins - expected) < 1e-9);
  // Ore worth more than the bar: selling the ore beats making bars, so no income row.
  price[copper + R] = price[tin + R] = 300;
  assert.equal(planner.incomeChoices(p, [rare], 'melee').length, 0);
});

test('an ordinary craft from banked ore is charged for that ore too', () => {
  const planner = makePlanner(), d = planner.data;
  planner.watchMarket = () => {};
  const bar = d.jobs.find(j => j.skill === 'smithing' && j.name === 'Bronze bar');
  const [copper, tin] = bar.inputs.map(i => i.itemId);
  const p = player(planner, {levels: {smithing: 10, mining: 10}, x: d.banks[0].x, y: d.banks[0].y,
    bank: {[copper]: 5000, [tin]: 5000}});
  const plain = planner.candidates(p, 'melee', {}).find(c => c.recipeId === bar.id && !c.rarity);
  assert.ok(plain.estimate.owned[copper] > 0, 'uses the banked ore');
  planner.marketUnitValue = (_p, id) => id === copper || id === tin ? 10 : 0;
  const [priced] = planner.incomeChoices(p, [plain], 'melee');
  assert.ok(!priced || priced.inputValue >= 10 * plain.estimate.owned[copper] - 1e-6, JSON.stringify(priced?.inputValue));
});
