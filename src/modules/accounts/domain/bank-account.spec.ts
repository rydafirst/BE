import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidAccountNumber, isValidBankCode, maskAccountNumber } from './bank-account.js';

test('accepts a valid 10-digit NUBAN', () => {
  assert.equal(isValidAccountNumber('0690000032'), true);
});

test('rejects non-10-digit or non-numeric account numbers', () => {
  assert.equal(isValidAccountNumber('06900000'), false);
  assert.equal(isValidAccountNumber('06900000321'), false);
  assert.equal(isValidAccountNumber('06900000ab'), false);
  assert.equal(isValidAccountNumber(''), false);
});

test('validates bank codes', () => {
  assert.equal(isValidBankCode('044'), true);
  assert.equal(isValidBankCode('999999'), true);
  assert.equal(isValidBankCode('4'), false);
  assert.equal(isValidBankCode('abc'), false);
});

test('masks all but the last 4 digits', () => {
  assert.equal(maskAccountNumber('0690000032'), '••••••0032');
});

test('never leaks digits for short/empty input', () => {
  assert.equal(maskAccountNumber('12'), '••••');
  assert.equal(maskAccountNumber(''), '••••');
});
