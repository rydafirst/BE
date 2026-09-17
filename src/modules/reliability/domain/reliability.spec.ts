import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLateness, activeStrikes, shouldSuspend, suspensionUntil, isSuspended, lateForfeitMinor,
  reliabilityScore, LATE_TOLERANCE, STRIKE_THRESHOLD, STRIKE_WINDOW_MS, SUSPENSION_MS, type Strike,
} from './reliability.js';

test('on time when the rider is within tolerance of the traffic-aware estimate (traffic excuses the delay)', () => {
  // Traffic said 20 min; rider took 24 min — within 25% tolerance → not their fault.
  const a = assessLateness({ actualSec: 24 * 60, staticEtaSec: 15 * 60, trafficAwareSec: 20 * 60 });
  assert.equal(a.verdict, 'on_time');
  assert.ok(a.ratio && a.ratio > 1); // slower than estimate, but excused
});

test('late only when the rider is well beyond what traffic accounts for', () => {
  // Traffic said 20 min; rider took 40 min (2x) — beyond the tolerance → late.
  const a = assessLateness({ actualSec: 40 * 60, staticEtaSec: 15 * 60, trafficAwareSec: 20 * 60 });
  assert.equal(a.verdict, 'late');
  assert.equal(a.trafficAwareSec, 1200);
});

test('exactly at the tolerance boundary is still on time (fail-safe toward the rider)', () => {
  const boundary = 20 * 60 * LATE_TOLERANCE; // 25 min
  assert.equal(assessLateness({ actualSec: boundary, staticEtaSec: 900, trafficAwareSec: 1200 }).verdict, 'on_time');
  assert.equal(assessLateness({ actualSec: boundary + 1, staticEtaSec: 900, trafficAwareSec: 1200 }).verdict, 'late');
});

test('no traffic estimate → uncertain (goes to an admin, never an automatic strike)', () => {
  const a = assessLateness({ actualSec: 60 * 60, staticEtaSec: 15 * 60 }); // very slow, but no traffic data
  assert.equal(a.verdict, 'uncertain');
  assert.equal(a.trafficAwareSec, undefined);
});

test('assessLateness rejects bad input', () => {
  assert.throws(() => assessLateness({ actualSec: -1, staticEtaSec: 100 }));
  assert.throws(() => assessLateness({ actualSec: 100, staticEtaSec: 0 }));
});

test('strikes expire out of the rolling window', () => {
  const now = 1_000_000_000_000;
  const strikes: Strike[] = [
    { at: now - 1000, jobId: 'a' },                    // recent
    { at: now - STRIKE_WINDOW_MS + 1000, jobId: 'b' }, // just inside the window
    { at: now - STRIKE_WINDOW_MS - 1000, jobId: 'c' }, // just expired
  ];
  const active = activeStrikes(strikes, now);
  assert.equal(active.length, 2);
  assert.ok(!active.some((s) => s.jobId === 'c'));
});

test('suspension triggers at the threshold and lasts one day', () => {
  assert.equal(shouldSuspend(STRIKE_THRESHOLD - 1), false);
  assert.equal(shouldSuspend(STRIKE_THRESHOLD), true);
  const now = 1_700_000_000_000;
  const until = suspensionUntil(now);
  assert.equal(until - now, SUSPENSION_MS);
  assert.equal(isSuspended(until, now), true);
  assert.equal(isSuspended(until, until + 1), false); // expired
  assert.equal(isSuspended(undefined, now), false);
});

test('money forfeit is a percentage of the DELIVERY fee only', () => {
  assert.equal(lateForfeitMinor(280_000), 28_000);        // 10% of ₦2,800
  assert.equal(lateForfeitMinor(280_000, 25), 70_000);    // 25% override
  assert.equal(lateForfeitMinor(0), 0);
  assert.throws(() => lateForfeitMinor(-1));
});

test('reliability score', () => {
  assert.equal(reliabilityScore(0, 0), 100);   // brand-new rider
  assert.equal(reliabilityScore(9, 10), 90);
  assert.equal(reliabilityScore(0, 4), 0);
});
