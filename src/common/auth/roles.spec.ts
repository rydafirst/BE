import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminCan, roleHasPermission } from './roles.js';

test('deny-by-default: customer cannot accept jobs or touch admin', () => {
  assert.equal(roleHasPermission('CUSTOMER', 'job:create'), true);
  assert.equal(roleHasPermission('CUSTOMER', 'job:accept'), false);
  assert.equal(roleHasPermission('CUSTOMER', 'admin:kyc:review'), false);
});

test('rider can accept jobs and request payout but not create as customer flow', () => {
  assert.equal(roleHasPermission('RIDER', 'job:accept'), true);
  assert.equal(roleHasPermission('RIDER', 'payout:request'), true);
  assert.equal(roleHasPermission('RIDER', 'job:create'), false);
});

test('admin needs the matching scope for an action', () => {
  assert.equal(adminCan(['KYC'], 'admin:kyc:review'), true);
  assert.equal(adminCan(['FINANCE'], 'admin:kyc:review'), false);
  assert.equal(adminCan(['DISPUTE'], 'admin:dispute:resolve'), true);
});
