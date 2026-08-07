import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipientPhoneVisibleToRider, redactRecipientPhoneForRider } from './recipient-visibility.js';
import { type JobStatus } from './job-state-machine.js';

test('rider cannot see the recipient phone before pickup', () => {
  for (const s of ['ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP'] as JobStatus[]) {
    assert.equal(recipientPhoneVisibleToRider(s), false, s);
  }
});

test('rider can see the recipient phone from pickup onward (in-flight)', () => {
  for (const s of ['IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION'] as JobStatus[]) {
    assert.equal(recipientPhoneVisibleToRider(s), true, s);
  }
});

const recipient = { name: 'Oscar', phone: '08083039337' };

test('redaction: pre-pickup rider payload drops the phone but keeps the name', () => {
  const out = redactRecipientPhoneForRider({ status: 'AT_PICKUP' as JobStatus, recipient }, true);
  assert.equal(out.recipient?.name, 'Oscar');
  assert.equal(out.recipient?.phone, undefined);
});

test('redaction: post-pickup rider keeps the phone', () => {
  const out = redactRecipientPhoneForRider({ status: 'IN_PROGRESS' as JobStatus, recipient }, true);
  assert.equal(out.recipient?.phone, '08083039337');
});

test('redaction: the customer (their own data) always keeps the phone', () => {
  const out = redactRecipientPhoneForRider({ status: 'AT_PICKUP' as JobStatus, recipient }, false);
  assert.equal(out.recipient?.phone, '08083039337');
});

test('redaction: a job with no recipient is returned untouched', () => {
  const j = { status: 'AT_PICKUP' as JobStatus };
  assert.deepEqual(redactRecipientPhoneForRider(j, true), j);
});
