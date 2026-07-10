import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApproveKyc, canKycTransition, riderCanOperate, type KycInputs } from './kyc-state.js';

const full: KycInputs = {
  ninVerified: true, bvnVerified: true, idDocUploaded: true, selfieMatched: true, addressProvided: true,
};

test('cannot approve without NIN + BVN verified', () => {
  assert.equal(canApproveKyc(full), true);
  assert.equal(canApproveKyc({ ...full, ninVerified: false }), false);
  assert.equal(canApproveKyc({ ...full, bvnVerified: false }), false);
});

test('rider can only operate when APPROVED', () => {
  assert.equal(riderCanOperate('APPROVED'), true);
  for (const s of ['UNSUBMITTED', 'PENDING', 'REJECTED'] as const) {
    assert.equal(riderCanOperate(s), false);
  }
});

test('rejected rider may resubmit; approved is terminal', () => {
  assert.equal(canKycTransition('REJECTED', 'PENDING'), true);
  assert.equal(canKycTransition('APPROVED', 'PENDING'), false);
  assert.equal(canKycTransition('UNSUBMITTED', 'APPROVED'), false);
});
