import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';
import { assertBalanced, deriveBalance, UnbalancedLedgerError, type LedgerEntry } from './ledger.js';

test('accepts a balanced transaction', () => {
  const e: LedgerEntry[] = [
    { jobId: 'j1', account: 'EXTERNAL', direction: 'DEBIT', amount: Money.of(2300) },
    { jobId: 'j1', account: 'ESCROW', direction: 'CREDIT', amount: Money.of(2300) },
  ];
  assert.doesNotThrow(() => assertBalanced(e));
});

test('rejects an unbalanced transaction', () => {
  const e: LedgerEntry[] = [
    { jobId: 'j1', account: 'EXTERNAL', direction: 'DEBIT', amount: Money.of(2300) },
    { jobId: 'j1', account: 'ESCROW', direction: 'CREDIT', amount: Money.of(2000) },
  ];
  assert.throws(() => assertBalanced(e), UnbalancedLedgerError);
});

test('derives account balance as credits minus debits', () => {
  const e: LedgerEntry[] = [
    { jobId: 'j1', account: 'ESCROW', direction: 'CREDIT', amount: Money.of(2300) },
    { jobId: 'j1', account: 'ESCROW', direction: 'DEBIT', amount: Money.of(800) },
  ];
  assert.equal(deriveBalance(e, 'ESCROW').amount, 1500);
});
