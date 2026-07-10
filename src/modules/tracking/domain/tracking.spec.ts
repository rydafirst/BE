import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessJobChannel, etaSeconds, isStale, shouldEmit } from './tracking.js';

test('emits first ping, then throttles within the interval', () => {
  assert.equal(shouldEmit(null, 1000), true);
  assert.equal(shouldEmit(1000, 1500), false);
  assert.equal(shouldEmit(1000, 2000), true);
});

test('marks location stale after max age (reconnecting, not frozen)', () => {
  assert.equal(isStale(1000, 1000 + 5000), false);
  assert.equal(isStale(1000, 1000 + 9000), true);
  assert.equal(isStale(null, 1000), true);
});

test('eta grows with distance', () => {
  const near = etaSeconds({ lat: 6.5, lng: 3.3 }, { lat: 6.51, lng: 3.31 });
  const far = etaSeconds({ lat: 6.5, lng: 3.3 }, { lat: 6.7, lng: 3.5 });
  assert.ok(far > near);
});

test('only the customer or assigned rider may access the channel', () => {
  const job = { customerId: 'c1', riderId: 'r1' };
  assert.equal(canAccessJobChannel('c1', job), true);
  assert.equal(canAccessJobChannel('r1', job), true);
  assert.equal(canAccessJobChannel('stranger', job), false);
});
