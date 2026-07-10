import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { reconcile, type EscrowTotals } from './reconciliation.js';

const t = (h: number, r: number, f: number): EscrowTotals => ({
  held: Money.of(h), released: Money.of(r), refunded: Money.of(f),
});

test('in sync when totals match', () => {
  const res = reconcile(t(10000, 6000, 4000), t(10000, 6000, 4000));
  assert.equal(res.inSync, true);
});

test('detects drift and reports the signed difference', () => {
  const res = reconcile(t(10000, 6000, 4000), t(10000, 5000, 4000));
  assert.equal(res.inSync, false);
  assert.equal(res.drift.released, 1000);
});
