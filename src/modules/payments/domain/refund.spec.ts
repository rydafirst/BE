import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { computeSettlement } from './refund.js';

const collected = Money.of(2300); // ₦23.00

test('RELEASE_FULL pays rider everything', () => {
  const s = computeSettlement({ collected, outcome: 'RELEASE_FULL' });
  assert.equal(s.toRider.amount, 2300);
  assert.equal(s.toCustomer.amount, 0);
});

test('REFUND_FULL refunds the customer everything', () => {
  const s = computeSettlement({ collected, outcome: 'REFUND_FULL' });
  assert.equal(s.toRider.amount, 0);
  assert.equal(s.toCustomer.amount, 2300);
});

test('FAILED_ATTEMPT pays capped fee, refunds the rest', () => {
  const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(800) });
  assert.equal(s.toRider.amount, 800);
  assert.equal(s.toCustomer.amount, 1500);
});

test('fees can never exceed the collected amount', () => {
  const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(999999) });
  assert.equal(s.toRider.amount, 2300);
  assert.equal(s.toCustomer.amount, 0);
});

test('DISPUTE_SPLIT honours the rider share and reconciles', () => {
  const s = computeSettlement({ collected, outcome: 'DISPUTE_SPLIT', riderShare: Money.of(1000) });
  assert.equal(s.toRider.amount, 1000);
  assert.equal(s.toCustomer.amount, 1300);
});

test('INVARIANT: toRider + toCustomer always equals collected', () => {
  for (const fee of [0, 1, 800, 2299, 2300, 5000]) {
    const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(fee) });
    assert.equal(s.toRider.add(s.toCustomer).amount, collected.amount);
  }
});
