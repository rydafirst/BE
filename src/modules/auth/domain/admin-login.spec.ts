import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ADMIN_SCOPES, isAdminPhone } from './admin-login.js';

test('matches an allowlisted phone (trimmed)', () => {
  assert.equal(isAdminPhone(['+2348012345678'], '+2348012345678'), true);
  assert.equal(isAdminPhone([' +2348012345678 '], '+2348012345678'), true);
});

test('rejects non-listed or empty phones', () => {
  assert.equal(isAdminPhone(['+2348012345678'], '+2348099999999'), false);
  assert.equal(isAdminPhone([], '+2348012345678'), false);
  assert.equal(isAdminPhone(['+2348012345678'], ''), false);
  assert.equal(isAdminPhone([''], ''), false);
});

test('admins get the full scope set', () => {
  assert.deepEqual([...ALL_ADMIN_SCOPES], ['KYC', 'DISPUTE', 'FINANCE', 'OPS']);
});
