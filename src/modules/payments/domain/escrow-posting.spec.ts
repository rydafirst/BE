import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { computeSettlement } from './refund.js';
import { buildHoldPosting, buildSettlementPosting } from './escrow-posting.js';
import { assertBalanced, deriveBalance } from './ledger.js';

const collected = Money.of(2300);

test('hold posting is balanced and credits escrow the full amount', () => {
  const p = buildHoldPosting('j1', collected);
  assert.doesNotThrow(() => assertBalanced(p));
  assert.equal(deriveBalance(p, 'ESCROW').amount, 2300);
});

test('after hold + release, escrow nets to zero and rider is owed everything', () => {
  const s = computeSettlement({ collected, outcome: 'RELEASE_FULL' });
  const all = [...buildHoldPosting('j1', collected), ...buildSettlementPosting('j1', s)];
  assert.doesNotThrow(() => assertBalanced(s.toRider.isZero() ? [] : all));
  assert.equal(deriveBalance(all, 'ESCROW').amount, 0);
  assert.equal(deriveBalance(all, 'RIDER_PAYABLE').amount, 2300);
});

test('failed-attempt splits escrow into rider payable + customer refund, balanced, escrow nets zero', () => {
  const s = computeSettlement({ collected, outcome: 'FAILED_ATTEMPT', attemptFee: Money.of(800) });
  const settle = buildSettlementPosting('j1', s);
  assert.doesNotThrow(() => assertBalanced(settle));
  const all = [...buildHoldPosting('j1', collected), ...settle];
  assert.equal(deriveBalance(all, 'ESCROW').amount, 0);
  assert.equal(deriveBalance(all, 'RIDER_PAYABLE').amount, 800);
  assert.equal(deriveBalance(all, 'CUSTOMER_REFUND').amount, 1500);
});

test('full refund: escrow nets zero, customer owed everything, rider nothing', () => {
  const s = computeSettlement({ collected, outcome: 'REFUND_FULL' });
  const all = [...buildHoldPosting('j1', collected), ...buildSettlementPosting('j1', s)];
  assert.equal(deriveBalance(all, 'ESCROW').amount, 0);
  assert.equal(deriveBalance(all, 'CUSTOMER_REFUND').amount, 2300);
});
