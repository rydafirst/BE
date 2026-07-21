/**
 * Stage timing is derived from an append-only log, so the tests focus on the messy realities of one:
 * events arriving out of order, retried writes producing duplicates, and clock skew between writers.
 * A timing bug here is not cosmetic — these numbers are what an ops person reads when a rider and a
 * sender disagree about what happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageDurations, timeInCurrentStage, totalElapsedMs, type StatusEvent } from './stage-timing.js';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const log: StatusEvent[] = [
  { status: 'ACCEPTED', at: T0 },
  { status: 'EN_ROUTE_PICKUP', at: T0 + 2 * MIN },
  { status: 'AT_PICKUP', at: T0 + 12 * MIN },
  { status: 'IN_PROGRESS', at: T0 + 15 * MIN },
];

test('measures each closed stage from its own start to the next transition', () => {
  const d = stageDurations(log, T0 + 20 * MIN);
  assert.deepEqual(d.map((x) => [x.status, x.ms / MIN]), [
    ['ACCEPTED', 2], ['EN_ROUTE_PICKUP', 10], ['AT_PICKUP', 3], ['IN_PROGRESS', 5],
  ]);
});

test('the current stage is marked open and keeps growing', () => {
  const d = stageDurations(log, T0 + 20 * MIN);
  assert.deepEqual(d.filter((x) => x.open).map((x) => x.status), ['IN_PROGRESS']);
  assert.equal(timeInCurrentStage(log, T0 + 20 * MIN), 5 * MIN);
  assert.equal(timeInCurrentStage(log, T0 + 25 * MIN), 10 * MIN);
});

test('an out-of-order log produces the same result as an ordered one', () => {
  const shuffled = [log[2]!, log[0]!, log[3]!, log[1]!];
  assert.deepEqual(stageDurations(shuffled, T0 + 20 * MIN), stageDurations(log, T0 + 20 * MIN));
});

test('a retried write that logs the same status twice counts as one stage', () => {
  const dupes: StatusEvent[] = [
    { status: 'ACCEPTED', at: T0 },
    { status: 'ACCEPTED', at: T0 + 30_000 },
    { status: 'EN_ROUTE_PICKUP', at: T0 + 2 * MIN },
  ];
  const d = stageDurations(dupes, T0 + 3 * MIN);
  assert.deepEqual(d.map((x) => x.status), ['ACCEPTED', 'EN_ROUTE_PICKUP']);
  // Measured from the FIRST time the status was entered, not the retry.
  assert.equal(d[0]?.ms, 2 * MIN);
});

test('clock skew never surfaces as a negative duration', () => {
  const skewed: StatusEvent[] = [
    { status: 'ARRIVED', at: T0 },
    { status: 'COMPLETED', at: T0 - 5 * MIN }, // writer clock behind
  ];
  for (const d of stageDurations(skewed, T0)) assert.ok(d.ms >= 0, `${d.status} went negative`);
});

test('an empty log is not an error', () => {
  assert.deepEqual(stageDurations([], T0), []);
  assert.equal(timeInCurrentStage([], T0), 0);
  assert.equal(totalElapsedMs([], T0), 0);
});

test('total elapsed runs from the first event to now', () => {
  assert.equal(totalElapsedMs(log, T0 + 20 * MIN), 20 * MIN);
});
