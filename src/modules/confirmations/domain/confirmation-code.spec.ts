import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCode, generateCode, CODE_LENGTH, CODE_MAX_ATTEMPTS, CODE_TTL_SECONDS, type CodeRecord } from './confirmation-code.js';

const rec = (o: Partial<CodeRecord> = {}): CodeRecord => ({
  kind: 'DELIVERY', codeHash: 'h', createdAtMs: 1000, attempts: 0, consumed: false, ...o,
});

test('generated code is 4 numeric digits', () => {
  const c = generateCode();
  assert.equal(c.length, CODE_LENGTH);
  assert.match(c, /^[0-9]+$/);
});

test('accepts fresh matching code', () => assert.deepEqual(checkCode(rec(), true, 1000), { ok: true }));
test('rejects expired', () => assert.equal(checkCode(rec(), true, 1000 + CODE_TTL_SECONDS * 1000 + 1).ok, false));
test('rejects after max attempts', () => assert.deepEqual(checkCode(rec({ attempts: CODE_MAX_ATTEMPTS }), true, 1000), { ok: false, reason: 'too_many_attempts' }));
test('rejects reuse', () => assert.deepEqual(checkCode(rec({ consumed: true }), true, 1000), { ok: false, reason: 'already_used' }));
test('rejects mismatch', () => assert.deepEqual(checkCode(rec(), false, 1000), { ok: false, reason: 'mismatch' }));
