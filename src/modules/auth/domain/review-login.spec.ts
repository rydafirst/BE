import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewLoginEnabled, isReviewPhone, reviewCodeMatches, parseReviewLogins, type ReviewLoginConfig } from './review-login.js';

const CUSTOMER = '+2348000000000';
const RIDER = '+2348111111111';

const on: ReviewLoginConfig = parseReviewLogins(`${CUSTOMER}:000000,${RIDER}:111111`);
const off: ReviewLoginConfig = parseReviewLogins('');

test('disabled (fail-closed) when unset', () => {
  assert.equal(reviewLoginEnabled(off), false);
  assert.equal(isReviewPhone(off, CUSTOMER), false);
  assert.equal(reviewCodeMatches(off, CUSTOMER, '000000'), false);
});

test('drops entries missing a phone or a valid code', () => {
  assert.equal(reviewLoginEnabled(parseReviewLogins(`${CUSTOMER}:`)), false);   // no code
  assert.equal(reviewLoginEnabled(parseReviewLogins(':000000')), false);        // no phone
  assert.equal(reviewLoginEnabled(parseReviewLogins(`${CUSTOMER}:abc`)), false); // non-numeric
  assert.equal(reviewLoginEnabled(parseReviewLogins(`${CUSTOMER}:123`)), false); // too short
});

test('supports several reviewer identities, each with its own code', () => {
  assert.equal(on.length, 2);
  assert.equal(reviewCodeMatches(on, CUSTOMER, '000000'), true);
  assert.equal(reviewCodeMatches(on, RIDER, '111111'), true);
  // codes are not interchangeable between identities
  assert.equal(reviewCodeMatches(on, CUSTOMER, '111111'), false);
  assert.equal(reviewCodeMatches(on, RIDER, '000000'), false);
});

test('rejects a reviewer phone with a wrong code', () => {
  assert.equal(reviewCodeMatches(on, CUSTOMER, '999999'), false);
  assert.equal(reviewCodeMatches(on, CUSTOMER, '00000'), false); // length mismatch
});

test('never affects any other phone', () => {
  assert.equal(isReviewPhone(on, '+2348999999999'), false);
  assert.equal(reviewCodeMatches(on, '+2348999999999', '000000'), false);
});

test('keeps the original single-identity vars working', () => {
  const legacy = parseReviewLogins('', CUSTOMER, '000000');
  assert.equal(reviewLoginEnabled(legacy), true);
  assert.equal(reviewCodeMatches(legacy, CUSTOMER, '000000'), true);
  // and merges with the list form without duplicating
  const both = parseReviewLogins(`${RIDER}:111111`, CUSTOMER, '000000');
  assert.equal(both.length, 2);
  assert.equal(reviewCodeMatches(both, RIDER, '111111'), true);
  assert.equal(reviewCodeMatches(both, CUSTOMER, '000000'), true);
});

test('tolerates whitespace and ignores blank entries', () => {
  const cfg = parseReviewLogins(` ${CUSTOMER} : 000000 , , ${RIDER}:111111 `);
  assert.equal(cfg.length, 2);
  assert.equal(reviewCodeMatches(cfg, CUSTOMER, '000000'), true);
});
