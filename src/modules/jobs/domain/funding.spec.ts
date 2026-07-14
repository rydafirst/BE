import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFunding } from './funding.js';

const base = { jobFlwTxRef: 'rf_job1_abcd', jobAmountMinor: 99_000, verifiedTxRef: 'rf_job1_abcd', verifiedAmountMinor: 99_000 };

test('funds when the transaction matches the job and covers the amount', () => {
  assert.deepEqual(decideFunding(base), { ok: true });
  // Overpayment is fine (still covers the fare).
  assert.deepEqual(decideFunding({ ...base, verifiedAmountMinor: 100_000 }), { ok: true });
});

test('rejects a transaction that is not this job\'s own checkout (no cross-funding)', () => {
  assert.deepEqual(decideFunding({ ...base, verifiedTxRef: 'rf_someone_else' }), { ok: false, reason: 'mismatch' });
  // A job with no checkout reference can never be funded by a supplied transaction id.
  assert.deepEqual(decideFunding({ ...base, jobFlwTxRef: undefined }), { ok: false, reason: 'mismatch' });
});

test('rejects an underpayment even when the reference matches', () => {
  assert.deepEqual(decideFunding({ ...base, verifiedAmountMinor: 100 }), { ok: false, reason: 'underpaid' });
});
