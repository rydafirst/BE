import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIdempotency, opKey } from './idempotency.js';

test('proceeds when no prior record', () => {
  assert.deepEqual(decideIdempotency(null), { action: 'proceed' });
});

test('returns cached result on replay (no double execution)', () => {
  const d = decideIdempotency({ key: 'k', result: { providerRef: 'abc' } });
  assert.deepEqual(d, { action: 'return_cached', result: { providerRef: 'abc' } });
});

test('op keys are deterministic and scoped per operation + job', () => {
  assert.equal(opKey('settle', 'job1'), 'settle:job1:v1');
  assert.notEqual(opKey('hold', 'job1'), opKey('settle', 'job1'));
});
