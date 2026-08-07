import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCounterparty, chatNotification } from './notify.js';

const job = { customerId: 'cust-1', riderId: 'rider-1' };

test('customer sending notifies the rider; rider sending notifies the customer', () => {
  assert.equal(chatCounterparty(job, 'cust-1'), 'rider-1');
  assert.equal(chatCounterparty(job, 'rider-1'), 'cust-1');
});

test('the sender is never returned as their own counterparty', () => {
  assert.notEqual(chatCounterparty(job, 'cust-1'), 'cust-1');
  assert.notEqual(chatCounterparty(job, 'rider-1'), 'rider-1');
});

test('no rider assigned yet -> no counterparty (nobody is notified)', () => {
  assert.equal(chatCounterparty({ customerId: 'cust-1' }, 'cust-1'), undefined);
});

test('a non-party sender (should never reach here post-authz) notifies nobody', () => {
  assert.equal(chatCounterparty(job, 'stranger'), undefined);
});

test('notification content carries no message text (no lock-screen leak)', () => {
  const n = chatNotification();
  const secret = 'meet me at the back gate with the cash';
  assert.ok(!n.title.includes(secret) && !n.body.includes(secret));
  // The body is a fixed generic string, not derived from any message.
  assert.equal(n.body, 'You have a new message about your delivery.');
});
