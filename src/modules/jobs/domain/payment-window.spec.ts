import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPaymentExpired } from './payment-window.js';

const WINDOW = 20 * 60_000; // 20 minutes
const NOW = 1_000_000_000_000;

test('an unpaid order within the window is not expired', () => {
  assert.equal(isPaymentExpired('CREATED', NOW - 5 * 60_000, NOW, WINDOW), false);
});

test('an unpaid order exactly at the window boundary is not yet expired', () => {
  assert.equal(isPaymentExpired('CREATED', NOW - WINDOW, NOW, WINDOW), false);
});

test('an unpaid order past the window is expired', () => {
  assert.equal(isPaymentExpired('CREATED', NOW - WINDOW - 1, NOW, WINDOW), true);
});

test('a funded/searching order never expires, however old', () => {
  assert.equal(isPaymentExpired('FUNDED', NOW - 10 * WINDOW, NOW, WINDOW), false);
  assert.equal(isPaymentExpired('SEARCHING', NOW - 10 * WINDOW, NOW, WINDOW), false);
});

test('terminal states never expire', () => {
  assert.equal(isPaymentExpired('RELEASED', NOW - 10 * WINDOW, NOW, WINDOW), false);
  assert.equal(isPaymentExpired('CANCELLED', NOW - 10 * WINDOW, NOW, WINDOW), false);
});
