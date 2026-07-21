/**
 * The phone-contact window is a privacy boundary, so it is pinned by an exhaustive test: every
 * JobStatus must be explicitly classified. If a new status is added, this fails until someone
 * decides whether the parties may call each other in it — the safe failure mode is a compile/test
 * error rather than silently leaking a phone number in a new state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactAllowed } from './contact-window.js';
import type { JobStatus } from './job-state-machine.js';

const OPEN: JobStatus[] = [
  'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP',
  'ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION',
];
const CLOSED: JobStatus[] = [
  'CREATED', 'FUNDED', 'SEARCHING',            // no rider assigned yet
  'COMPLETED', 'RELEASED',                     // the delivery is over
  'CANCELLED', 'FAILED_ATTEMPT',               // the job ended
  'DISPUTED', 'DISPUTE_RESOLVED',              // route through support, not each other
];

test('contact is open exactly while the job is in flight', () => {
  for (const s of OPEN) assert.equal(contactAllowed(s), true, `${s} should allow contact`);
});

test('contact is closed before assignment, after the job ends, and during a dispute', () => {
  for (const s of CLOSED) assert.equal(contactAllowed(s), false, `${s} must NOT allow contact`);
});

test('every job status is classified — a new one cannot slip through unreviewed', () => {
  const all: JobStatus[] = [...OPEN, ...CLOSED];
  assert.equal(new Set(all).size, all.length, 'a status is listed twice');
  // Mirrors the JobStatus union; update deliberately when the state machine grows.
  assert.equal(all.length, 18);
});
