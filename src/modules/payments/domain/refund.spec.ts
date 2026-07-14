import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { computeSettlement } from './refund.js';

const collected = Money.of(2300); // ₦23.00 total the customer paid

test('RELEASE_FULL keeps the platform fee and pays the rider the remainder', () => {
  const s = computeSettlement({ collected, outcome: 'RELEASE_FULL', platformFee: Money.of(300) });
  assert.equal(s.toPlatform.amount, 300);
  assert.equal(s.toRider.amount, 2000);
  assert.equal(s.toCustomer.amount, 0);
});

test('RELEASE_FULL with no fee configured pays the rider everything', () => {
  const s = computeSettlement({ collected, outcome: 'RELEASE_FULL' });
  assert.equal(s.toPlatform.amount, 0);
  assert.equal(s.toRider.amount, 2300);
  assert.equal(s.toCustomer.amount, 0);
});

test('platform fee can never exceed the collected amount', () => {
  const s = computeSettlement({ collected, outcome: 'RELEASE_FULL', platformFee: Money.of(999999) });
  assert.equal(s.toPlatform.amount, 2300);
  assert.equal(s.toRider.amount, 0);
  assert.equal(s.toCustomer.amount, 0);
});

test('REFUND_FULL refunds the customer everything; platform earns nothing', () => {
  const s = computeSettlement({ collected, outcome: 'REFUND_FULL' });
  assert.equal(s.toRider.amount, 0);
  assert.equal(s.toPlatform.amount, 0);
  assert.equal(s.toCustomer.amount, 2300);
});

test('FAILED_ATTEMPT pays a capped fee to the rider, refunds the rest, platform earns nothing', () => {
  const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(800) });
  assert.equal(s.toRider.amount, 800);
  assert.equal(s.toPlatform.amount, 0);
  assert.equal(s.toCustomer.amount, 1500);
});

test('fees can never exceed the collected amount', () => {
  const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(999999) });
  assert.equal(s.toRider.amount, 2300);
  assert.equal(s.toCustomer.amount, 0);
});

test('DISPUTE_SPLIT honours the rider share and reconciles; platform earns nothing', () => {
  const s = computeSettlement({ collected, outcome: 'DISPUTE_SPLIT', riderShare: Money.of(1000) });
  assert.equal(s.toRider.amount, 1000);
  assert.equal(s.toPlatform.amount, 0);
  assert.equal(s.toCustomer.amount, 1300);
});

test('INVARIANT: toRider + toPlatform + toCustomer always equals collected', () => {
  for (const fee of [0, 1, 300, 800, 2299, 2300, 5000]) {
    const rel = computeSettlement({ collected, outcome: 'RELEASE_FULL', platformFee: Money.of(fee) });
    assert.equal(rel.toRider.add(rel.toPlatform).add(rel.toCustomer).amount, collected.amount);
    const fa = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(fee) });
    assert.equal(fa.toRider.add(fa.toPlatform).add(fa.toCustomer).amount, collected.amount);
  }
});
