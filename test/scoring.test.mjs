import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, KIND_BONUS, hitPoints, isPerfect, maxScore } from '../public/js/scoring.js';

test('очки за попадание: база, дальность и трудная траектория', () => {
  assert.equal(hitPoints(0, 1).total, 10);
  assert.equal(hitPoints(1, 1).total, 15);
  assert.equal(hitPoints(1, 1, 'rabbit').total, 15 + KIND_BONUS.rabbit);
  assert.equal(hitPoints(0.5, 1, 'overhead').base, 10 + 3 + KIND_BONUS.overhead);
});

test('серия: +3 за каждое попадание подряд, не больше +15', () => {
  assert.equal(hitPoints(0, 2).streakBonus, 3);
  assert.equal(hitPoints(0, 4).streakBonus, 9);
  assert.equal(hitPoints(0, 6).streakBonus, RULES.streakMax);
  assert.equal(hitPoints(0, 20).streakBonus, RULES.streakMax);
});

test('каждые 5 подряд — бонус серии 5 × длина', () => {
  assert.equal(hitPoints(0, 4).milestone, 0);
  assert.equal(hitPoints(0, 5).milestone, 25);
  assert.equal(hitPoints(0, 10).milestone, 50);
  assert.equal(hitPoints(0, 25).milestone, 125);
});

test('без промахов — только все тарелки и ни одного лишнего выстрела', () => {
  assert.equal(isPerfect(25, 25, 25), true);
  assert.equal(isPerfect(25, 26, 25), false);
  assert.equal(isPerfect(24, 24, 25), false);
});

test('предел для сервера не меньше любого честного результата', () => {
  // идеальный раунд: все 25 зайцев одной серией в самом конце траектории
  let best = 0;
  for (let s = 1; s <= 25; s++) best += hitPoints(1, s, 'rabbit').total;
  best += RULES.perfect;
  assert.equal(maxScore(25, 25, 25), best);
  // с промахами бонус «без промахов» не положен
  assert.equal(maxScore(25, 27, 25), best - RULES.perfect);
  assert.ok(maxScore(10, 12, 25) < maxScore(11, 12, 25));
});
