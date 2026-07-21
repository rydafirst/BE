import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidExpoToken, pushChannel, pushPriority, pushSound, readExpoTickets } from './push.js';

const A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

test('counts accepted tickets', () => {
  const r = readExpoTickets([A, B], { data: [{ status: 'ok' }, { status: 'ok' }] });
  assert.equal(r.accepted, 2);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.invalidTokens, []);
});

test('a 200 response with per-message errors is reported as failure, not success', () => {
  // This is the case that made push failures invisible: HTTP 200, nothing delivered.
  const r = readExpoTickets([A, B], {
    data: [{ status: 'ok' }, { status: 'error', message: 'Message too big', details: { error: 'MessageTooBig' } }],
  });
  assert.equal(r.accepted, 1);
  assert.deepEqual(r.failed, [{ token: B, reason: 'MessageTooBig' }]);
});

test('only DeviceNotRegistered retires a token', () => {
  const r = readExpoTickets([A, B], {
    data: [
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ],
  });
  // Rate limiting is transient — retiring that device would silently stop notifying a real rider.
  assert.deepEqual(r.invalidTokens, [A]);
  assert.equal(r.failed.length, 2);
});

test('falls back to the ticket message when no error code is given', () => {
  const r = readExpoTickets([A], { data: [{ status: 'error', message: 'something went wrong' }] });
  assert.deepEqual(r.failed, [{ token: A, reason: 'something went wrong' }]);
  assert.deepEqual(r.invalidTokens, []);
});

test('an unrecognised or mismatched body never retires tokens', () => {
  // Pruning on a shape we do not understand would delete every device a user owns.
  for (const body of [null, undefined, {}, { data: 'nope' }, { data: [{ status: 'ok' }] }, 'garbage']) {
    const r = readExpoTickets([A, B], body);
    assert.deepEqual(r.invalidTokens, [], `must not prune on ${JSON.stringify(body)}`);
    assert.equal(r.accepted, 0);
  }
});

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
