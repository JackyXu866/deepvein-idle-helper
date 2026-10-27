import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlanner, player} from './helpers.js';

// A cooking stage to 65 being prepared with Shrimp, set up before cooking 60
// unlocked Lobster (36 XP per cook against 4, about 4x the XP per minute even
// counting the fishing). 21,901 Shrimp are already in the bank.
function cook(preparing) {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  planner.perkUsage = {'job:61': {seconds: 3600}}; // measured: the account cooks
  const p = player(planner, {levels: {cooking: 64, fishing: 66}, coins: 1.7e6, hp: 100, x: d.banks[0].x, y: d.banks[0].y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {20: 21901, 25: 453}});
  const goal = {skill: 'cooking', target: 65, growth: true, development: true, stage: 65, budget: {coins: 0, items: {}},
    craftPreparation: {jobId: preparing, amount: 37622}, recipes: {cooking: preparing}, recipeRarities: {cooking: 0}, recipeLevels: {cooking: 64}};
  planner.plan(p, goal, 'melee');
  return goal;
}

test('a stage prepared with a much weaker recipe switches to the better one', () => {
  const goal = cook(61); // Cook shrimp
  assert.equal(goal.recipes.cooking, 66, 'Cook lobster');
  assert.equal(goal.craftPreparation?.jobId, 66);
  assert.ok(goal.craftPreparation.amount < 6000, `Lobster cooks for the stage: ${goal.craftPreparation.amount}`);
});

test('the plan tab\'s XP table shows the stage choice\'s own ratings, with ★ on what runs', async () => {
  const {planView} = await import('../src/planner/plan-view.js');
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const p = player(planner, {levels: {cooking: 64, fishing: 66}, coins: 1.7e6, hp: 100, x: d.banks[0].x, y: d.banks[0].y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {20: 21901, 25: 453}});
  const goal = {skill: 'cooking', target: 65, growth: true, development: true, stage: 65, budget: {coins: 0, items: {}},
    craftPreparation: {jobId: 61, amount: 37622}, recipes: {cooking: 61}, recipeRarities: {cooking: 0}, recipeLevels: {cooking: 64}, recipeId: 61};
  planner.plan(p, goal, 'melee');
  const view = planView(d, planner, {goal, style: 'melee', mode: 'balanced', deferred: {}}, p);
  const ratings = planner.recipeRatings();
  assert.equal(view.xpBasis, 'stage');
  assert.equal(view.xpCandidates[0].xpH, ratings.rows[0].xp * 3600, 'the numbers the choice used');
  const starred = view.xpCandidates.find(r => r.chosen);
  assert.match(starred.label, /lobster/i, 'the recipe it switched to, not where the project started');
  assert.match(view.goal.via, /lobster/i);
});

test('a stage already on the best recipe keeps its preparation', () => {
  const goal = cook(66);
  assert.equal(goal.recipes.cooking, 66);
  assert.equal(goal.craftPreparation?.jobId, 66);
});

test('a saved recipe gives way when a clearly better one is already in stock (9,946 Lobster)', () => {
  const planner = makePlanner(), d = planner.data, R = d.rarityScale;
  const tuna = d.jobs.find(j => j.name === 'Cook tuna');
  const p = player(planner, {levels: {cooking: 63, fishing: 66}, coins: 1.7e6, hp: 100, x: d.banks[0].x, y: d.banks[0].y,
    path: null, activity: 'idle', equipment: {pan: 363 + 2 * R}, bank: {20: 32768, 25: 9946, [tuna.inputs[0].itemId]: 12639}});
  const goal = {skill: 'cooking', target: 65, growth: true, development: true, stage: 65, budget: {coins: 0, items: {}},
    recipes: {cooking: 61}, recipeRarities: {cooking: 0}, recipeLevels: {cooking: 63}};
  const plan = planner.plan(p, goal, 'melee');
  assert.equal(goal.recipes.cooking, 66, JSON.stringify([plan?.intent, plan?.reason]));
});
