import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_JOIN_SLA_MS, botFollowUps, botOpeningPrompt, botStep, escalate, isFlowComplete,
  isSupportCategory, scriptLength, type EscalatableThread,
} from './support.js';

test('every category exposes an opening prompt and a final free-text step', () => {
  for (const c of ['PAYMENT', 'DELIVERY_ISSUE', 'CONDUCT', 'ACCOUNT', 'APP_ISSUE', 'OTHER'] as const) {
    assert.ok(botOpeningPrompt(c).length > 0, `${c} has an opening prompt`);
    const last = botStep(c, scriptLength(c) - 1);
    assert.equal(last?.kind, 'freetext', `${c} ends with a describe-your-issue step`);
  }
});

test('bot funnel advances: choice step offers taps, free-text step offers none', () => {
  // DELIVERY_ISSUE = [choice, choice, freetext]
  assert.equal(scriptLength('DELIVERY_ISSUE'), 3);
  assert.ok(botFollowUps('DELIVERY_ISSUE', 0).length >= 2, 'step 0 has tap options');
  assert.ok(botFollowUps('DELIVERY_ISSUE', 1).length >= 2, 'step 1 has tap options');
  assert.equal(botFollowUps('DELIVERY_ISSUE', 2).length, 0, 'the free-text step has no taps');
});

test('OTHER is a single free-text step', () => {
  assert.equal(scriptLength('OTHER'), 1);
  assert.equal(botStep('OTHER', 0)?.kind, 'freetext');
});

test('isFlowComplete only once every scripted step is answered', () => {
  // PAYMENT = [choice, freetext] -> 2 steps
  assert.equal(isFlowComplete('PAYMENT', 1), false); // answered the choice, free-text still pending
  assert.equal(isFlowComplete('PAYMENT', 2), true); // answered both
  assert.equal(isFlowComplete('OTHER', 1), true); // single step answered
});

test('escalate moves the thread to AWAITING_AGENT with a 30-minute deadline, without mutating input', () => {
  assert.equal(AGENT_JOIN_SLA_MS, 30 * 60_000);
  const now = 1_000_000;
  const thread: EscalatableThread = { status: 'BOT' };
  const out = escalate(thread, now);
  assert.equal(out.status, 'AWAITING_AGENT');
  assert.equal(out.agentJoinDeadline, now + 30 * 60_000);
  assert.equal(thread.status, 'BOT', 'original is untouched (pure)');
});

test('isSupportCategory guards unknown input', () => {
  assert.equal(isSupportCategory('PAYMENT'), true);
  assert.equal(isSupportCategory('nope'), false);
  assert.equal(isSupportCategory(42), false);
});
