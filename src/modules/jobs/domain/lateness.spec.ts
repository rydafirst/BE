import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latenessTier, expectedDropSeconds, pickedUpAt, isDropLegStage, DROP_LEG_STAGES,
} from './lateness.js';
import { type JobStatus } from './job-state-machine.js';
import { type StatusEvent } from './stage-timing.js';

test('tier: on time until the rider threshold, then rider, then all', () => {
  const expectedSec = 600; // 10 min ETA
  assert.equal(latenessTier({ expectedSec, elapsedSec: 500 }), 'none');
  assert.equal(latenessTier({ expectedSec, elapsedSec: 899 }), 'none', 'just under 1.5x');
  assert.equal(latenessTier({ expectedSec, elapsedSec: 900 }), 'rider', 'exactly 1.5x');
  assert.equal(latenessTier({ expectedSec, elapsedSec: 1199 }), 'rider', 'just under 2x');
  assert.equal(latenessTier({ expectedSec, elapsedSec: 1200 }), 'all', 'exactly 2x');
});

test('tier: a non-positive expected time can never read as late', () => {
  assert.equal(latenessTier({ expectedSec: 0, elapsedSec: 10_000 }), 'none');
  assert.equal(latenessTier({ expectedSec: -1, elapsedSec: 10_000 }), 'none');
});

test('expectedDropSeconds grows with distance and is always positive', () => {
  const near = expectedDropSeconds({ lat: 6.5, lng: 3.3 }, { lat: 6.51, lng: 3.31 });
  const far = expectedDropSeconds({ lat: 6.5, lng: 3.3 }, { lat: 6.7, lng: 3.6 });
  assert.ok(near > 0);
  assert.ok(far > near);
});

test('pickedUpAt returns the earliest IN_PROGRESS, or undefined before pickup', () => {
  const events: StatusEvent[] = [
    { status: 'ACCEPTED', at: 100 },
    { status: 'IN_PROGRESS', at: 300 },
    { status: 'EN_ROUTE_DROP', at: 500 },
  ];
  assert.equal(pickedUpAt(events), 300);
  assert.equal(pickedUpAt([{ status: 'ACCEPTED', at: 100 } as StatusEvent]), undefined);
});

test('drop-leg stages exclude pre-pickup and recipient-waiting stages', () => {
  for (const s of ['IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE'] as JobStatus[]) {
    assert.ok(isDropLegStage(s), s);
  }
  for (const s of ['ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'WAITING', 'AWAITING_RESOLUTION'] as JobStatus[]) {
    assert.equal(isDropLegStage(s), false, s);
  }
  assert.deepEqual([...DROP_LEG_STAGES], ['IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE']);
});
