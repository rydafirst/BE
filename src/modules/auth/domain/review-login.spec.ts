import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewLoginEnabled, isReviewPhone, reviewCodeMatches, type ReviewLoginConfig } from './review-login.js';

const on: ReviewLoginConfig = { phone: '+2348000000000', otp: '000000' };
const off: ReviewLoginConfig = { phone: '', otp: '' };

test('disabled (fail-closed) when unset', () => {
  assert.equal(reviewLoginEnabled(off), false);
  assert.equal(isReviewPhone(off, '+2348000000000'), false);
  assert.equal(reviewCodeMatches(off, '+2348000000000', '000000'), false);
});

test('disabled when only one of phone/otp is set', () => {
  assert.equal(reviewLoginEnabled({ phone: '+2348000000000', otp: '' }), false);
  assert.equal(reviewLoginEnabled({ phone: '', otp: '000000' }), false);
});

test('enabled and matches the exact phone + code', () => {
  assert.equal(reviewLoginEnabled(on), true);
  assert.equal(isReviewPhone(on, '+2348000000000'), true);
  assert.equal(reviewCodeMatches(on, '+2348000000000', '000000'), true);
});

test('rejects the reviewer phone with a wrong code', () => {
  assert.equal(reviewCodeMatches(on, '+2348000000000', '111111'), false);
  assert.equal(reviewCodeMatches(on, '+2348000000000', '00000'), false); // length mismatch
});

test('never affects any other phone', () => {
  assert.equal(isReviewPhone(on, '+2348111111111'), false);
  assert.equal(reviewCodeMatches(on, '+2348111111111', '000000'), false);
});
