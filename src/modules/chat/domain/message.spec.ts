import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMessageBody, MAX_MESSAGE_LEN } from './message.js';

test('trims and accepts a normal message', () => {
  assert.equal(sanitizeMessageBody('  hello there  '), 'hello there');
});

test('rejects empty / whitespace-only / non-string', () => {
  assert.throws(() => sanitizeMessageBody(''));
  assert.throws(() => sanitizeMessageBody('   '));
  assert.throws(() => sanitizeMessageBody(42 as unknown));
});

test('rejects an over-long message', () => {
  assert.throws(() => sanitizeMessageBody('x'.repeat(MAX_MESSAGE_LEN + 1)));
  assert.equal(sanitizeMessageBody('x'.repeat(MAX_MESSAGE_LEN)).length, MAX_MESSAGE_LEN);
});
