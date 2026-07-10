import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPolicy } from './cancellation.js';

test('cancel allowed with full refund once funded, before pickup', () => {
  assert.deepEqual(cancellationPolicy('FUNDED'), { allowed: true, refundFull: true });
  assert.deepEqual(cancellationPolicy('ACCEPTED'), { allowed: true, refundFull: true });
});

test('CREATED cancel is allowed but nothing to refund yet', () => {
  assert.deepEqual(cancellationPolicy('CREATED'), { allowed: true, refundFull: false });
});

test('no free cancel once in progress', () => {
  assert.equal(cancellationPolicy('IN_PROGRESS').allowed, false);
  assert.equal(cancellationPolicy('ARRIVED').allowed, false);
});
