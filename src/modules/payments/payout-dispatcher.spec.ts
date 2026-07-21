/**
 * PayoutDispatcher — controls WHEN the external disbursement runs.
 *
 * The contract that matters for money safety:
 *   - inline behaves exactly as the original synchronous code did (it is the default, so an
 *     unwired EscrowService cannot silently change behaviour);
 *   - deferred answers the caller immediately, but only AFTER persisting a "queued" state, so a
 *     crash between the response and the attempt still leaves the job visible to the retry queue;
 *   - a failure inside the deferred task can never reject into a floating promise (in Node an
 *     unhandled rejection terminates the process);
 *   - in-flight work is awaited on shutdown, so a redeploy does not drop a payout attempt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeferredPayoutDispatcher, InlinePayoutDispatcher } from './payout-dispatcher.port.js';

interface Outcome { pending: boolean; label: string }
const QUEUED: Outcome = { pending: true, label: 'queued' };
const DONE: Outcome = { pending: false, label: 'done' };

test('inline runs the task within the call and reports the real outcome', async () => {
  const seen: Outcome[] = [];
  const d = new InlinePayoutDispatcher();
  const out = await d.execute(async () => DONE, async (o) => { seen.push(o); }, QUEUED);
  assert.deepEqual(out, DONE);
  // The queued placeholder is never persisted inline — there is no window in which it is true.
  assert.deepEqual(seen, [DONE]);
});

test('deferred answers immediately with the queued outcome and runs the task afterwards', async () => {
  const seen: Outcome[] = [];
  let ran = false;
  const d = new DeferredPayoutDispatcher();

  const out = await d.execute(async () => { ran = true; return DONE; }, async (o) => { seen.push(o); }, QUEUED);

  assert.deepEqual(out, QUEUED, 'caller must not wait for the external transfer');
  // Queued state is already durable at this point — this is what keeps the job in the retry queue
  // if the process dies before the attempt completes.
  assert.deepEqual(seen, [QUEUED]);

  await d.onApplicationShutdown();
  assert.ok(ran, 'the task must still run');
  assert.deepEqual(seen, [QUEUED, DONE], 'the real outcome must overwrite the queued one');
});

test('deferred does not lose the queued write if persisting it fails', async () => {
  const d = new DeferredPayoutDispatcher();
  await assert.rejects(
    () => d.execute(async () => DONE, async () => { throw new Error('db down'); }, QUEUED),
    /db down/,
  );
});

test('a failure while settling the deferred task is swallowed, never an unhandled rejection', async () => {
  const d = new DeferredPayoutDispatcher();
  let calls = 0;
  const out = await d.execute(
    async () => DONE,
    async () => { calls++; if (calls > 1) throw new Error('db blip on final write'); },
    QUEUED,
  );
  assert.deepEqual(out, QUEUED);
  // Must resolve, not reject: the job simply stays flagged pending for admin retry.
  await d.onApplicationShutdown();
  assert.equal(calls, 2);
});

test('a throwing task is contained and does not crash the dispatcher', async () => {
  const d = new DeferredPayoutDispatcher();
  await d.execute(async () => { throw new Error('provider exploded'); }, async () => {}, QUEUED);
  await d.onApplicationShutdown();
});

test('shutdown waits for work that is still in flight', async () => {
  const d = new DeferredPayoutDispatcher();
  let finished = false;
  await d.execute(
    async () => { await new Promise((r) => setTimeout(r, 25)); finished = true; return DONE; },
    async () => {},
    QUEUED,
  );
  assert.equal(finished, false, 'still running right after the call returns');
  await d.onApplicationShutdown();
  assert.equal(finished, true, 'shutdown must not drop the attempt');
});

test('shutdown with nothing in flight is a no-op', async () => {
  await new DeferredPayoutDispatcher().onApplicationShutdown();
});
