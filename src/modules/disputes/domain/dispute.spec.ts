import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoResolve, canDisputeTransition, canOpenDispute, DISPUTE_WINDOW_MS,
  resolutionToSettlement, type EvidenceSignals,
} from './dispute.js';

const sig = (o: Partial<EvidenceSignals> = {}): EvidenceSignals => ({
  reachedGeofence: true, validCodeEntered: true, counterEvidence: false, ...o,
});

test('auto-refunds when the rider never reached the drop', () => {
  assert.deepEqual(autoResolve(sig({ reachedGeofence: false })), { tier: 'auto', resolution: 'REFUND' });
});

test('auto-releases on valid code + arrival + no counter-evidence', () => {
  assert.deepEqual(autoResolve(sig()), { tier: 'auto', resolution: 'RELEASE' });
});

test('escalates to a human when counter-evidence exists', () => {
  assert.deepEqual(autoResolve(sig({ counterEvidence: true })), { tier: 'manual' });
});

test('escalates ambiguous case (arrived but no valid code)', () => {
  assert.deepEqual(autoResolve(sig({ validCodeEntered: false })), { tier: 'manual' });
});

test('dispute window enforced', () => {
  assert.equal(canOpenDispute(1000, 1000 + DISPUTE_WINDOW_MS), true);
  assert.equal(canOpenDispute(1000, 1000 + DISPUTE_WINDOW_MS + 1), false);
});

test('resolution maps to settlement outcome', () => {
  assert.equal(resolutionToSettlement('RELEASE'), 'RELEASE_FULL');
  assert.equal(resolutionToSettlement('REFUND'), 'REFUND_FULL');
  assert.equal(resolutionToSettlement('SPLIT'), 'DISPUTE_SPLIT');
});

test('dispute status machine: resolved is terminal', () => {
  assert.equal(canDisputeTransition('OPEN', 'RESOLVED'), true);
  assert.equal(canDisputeTransition('RESOLVED', 'OPEN'), false);
});
