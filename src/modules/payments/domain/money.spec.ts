import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';

test('rejects non-integer and negative amounts', () => {
  assert.throws(() => Money.of(10.5));
  assert.throws(() => Money.of(-1));
});

test('adds and subtracts exactly', () => {
  assert.equal(Money.of(150).add(Money.of(350)).amount, 500);
  assert.equal(Money.of(500).subtract(Money.of(200)).amount, 300);
});

test('subtraction never goes negative', () => {
  assert.throws(() => Money.of(100).subtract(Money.of(101)));
});

test('cappedAt limits a fee to the collected amount', () => {
  assert.equal(Money.of(5000).cappedAt(Money.of(2300)).amount, 2300);
  assert.equal(Money.of(800).cappedAt(Money.of(2300)).amount, 800);
});
