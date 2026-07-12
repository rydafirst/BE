import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidExpoToken, pushChannel, pushPriority, pushSound } from './push.js';

test('accepts well-formed Expo push tokens', () => {
  assert.equal(isValidExpoToken('ExponentPushToken[abc123DEF]'), true);
  assert.equal(isValidExpoToken('ExpoPushToken[xyz-789]'), true);
});

test('rejects malformed or foreign tokens (fail-closed)', () => {
  assert.equal(isValidExpoToken(''), false);
  assert.equal(isValidExpoToken('not-a-token'), false);
  assert.equal(isValidExpoToken('ExponentPushToken[]'), false);           // empty body
  assert.equal(isValidExpoToken('ExponentPushToken[has space]'), false);  // whitespace injection
  assert.equal(isValidExpoToken('fcm:AAAA'), false);                       // wrong provider
});

test('urgent events ring; routine ones stay silent', () => {
  assert.equal(pushSound(true), 'default');
  assert.equal(pushSound(false), null);
  assert.equal(pushChannel(true), 'urgent');
  assert.equal(pushChannel(false), 'default');
  assert.equal(pushPriority(true), 'high');
  assert.equal(pushPriority(false), 'default');
});
