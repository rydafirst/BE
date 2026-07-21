/**
 * Flutterwave rejects a transfer reference containing anything outside [A-Za-z0-9_-], and our
 * internal keys use ':' — which is what produced the live "Refs can only contain..." 400.
 *
 * The property that matters for money is DETERMINISM: the same internal key must always map to the
 * same Flutterwave reference, because Flutterwave de-dupes on it. If a retry produced a different
 * reference, the rider could be paid twice. These tests pin that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flwReference } from './flutterwave.provider.js';

test('replaces the colons in our internal keys with underscores', () => {
  assert.equal(
    flwReference('settle:d28c09e7-e2d1-4857-9b92-62cb18b4f21b:v1:rider'),
    'settle_d28c09e7-e2d1-4857-9b92-62cb18b4f21b_v1_rider',
  );
});

test('is deterministic — a retry of the same key yields the same reference', () => {
  const key = 'settle:job-123:v1:refund';
  assert.equal(flwReference(key), flwReference(key));
});

test('keeps the rider and refund legs distinct after sanitising', () => {
  // The two legs of one settlement must never collapse to the same reference, or one could
  // overwrite the other at the PSP.
  const base = 'settle:d28c09e7-e2d1-4857-9b92-62cb18b4f21b:v1';
  assert.notEqual(flwReference(`${base}:rider`), flwReference(`${base}:refund`));
});

test('preserves the dashes already present in a UUID (they are allowed)', () => {
  assert.equal(flwReference('a-b-c'), 'a-b-c');
});

test('leaves an already-valid reference untouched', () => {
  assert.equal(flwReference('rf_job_1234_rider'), 'rf_job_1234_rider');
});

test('maps every disallowed character, not just colons', () => {
  assert.equal(flwReference('a b/c.d:e'), 'a_b_c_d_e');
});
