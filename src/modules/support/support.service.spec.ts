/**
 * SupportService — the automated support funnel + agent hand-off (launch #5/#6).
 *
 * The security boundary under test: users can only touch their OWN threads; the bot funnel escalates
 * exactly once the issue is described (30-minute SLA + AWAITING_AGENT); an agent reply assigns the
 * agent and flips the thread to AGENT_JOINED; and a job-scoped (#6) thread carries its jobId and is
 * fully resumable (its history survives). Notifications are best-effort — a push blowing up must never
 * fail the request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { InMemorySupportRepo } from './adapters/in-memory-support.repo.js';
import { AGENT_JOIN_SLA_MS } from './domain/support.js';
import { SupportService } from './support.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

const USER = 'user-1';
const OTHER = 'user-2';
const AGENT = 'agent-1';

function make() {
  const recorded: { userId: string; title: string }[] = [];
  const notify = {
    async record(userId: string, n: { title: string }) { recorded.push({ userId, title: n.title }); },
  } as unknown as NotificationsService;
  const svc = new SupportService(new InMemorySupportRepo(), notify);
  return { svc, recorded };
}

test('starting a thread seeds the bot opening prompt', async () => {
  const { svc } = make();
  const t = await svc.startThread(USER, 'PAYMENT');
  assert.equal(t.status, 'BOT');
  const msgs = await svc.listMessages(USER, t.id);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]!.sender, 'BOT');
});

test('bot funnel advances then escalates with a 30-min deadline and notifies admins', async () => {
  process.env.SUPPORT_ADMIN_IDS = 'admin-a, admin-b';
  const { svc, recorded } = make();
  const t = await svc.startThread(USER, 'PAYMENT'); // PAYMENT = [choice, freetext]

  // Answer the choice step — not complete yet, bot asks the free-text question.
  const step1 = await svc.answerBot(USER, t.id, 'Refund never came');
  assert.equal(step1.thread.status, 'BOT');

  // Answer the free-text step — flow completes -> escalate.
  const before = Date.now();
  const step2 = await svc.answerBot(USER, t.id, 'I paid 2000 naira on Monday and nothing came.');
  assert.equal(step2.thread.status, 'AWAITING_AGENT');
  assert.ok(step2.thread.agentJoinDeadline! >= before + AGENT_JOIN_SLA_MS);
  assert.ok(step2.thread.agentJoinDeadline! <= Date.now() + AGENT_JOIN_SLA_MS);

  // Both configured support admins were alerted.
  assert.deepEqual(recorded.map((r) => r.userId).sort(), ['admin-a', 'admin-b']);
  delete process.env.SUPPORT_ADMIN_IDS;
});

test('a user cannot touch another user’s thread (own-only)', async () => {
  const { svc } = make();
  const t = await svc.startThread(USER, 'ACCOUNT');
  await assert.rejects(() => svc.listMessages(OTHER, t.id), ForbiddenException);
  await assert.rejects(() => svc.answerBot(OTHER, t.id, 'hi'), ForbiddenException);
  await assert.rejects(() => svc.postMessage(OTHER, t.id, 'hi'), ForbiddenException);
});

test('agent reply assigns the agent, moves to AGENT_JOINED and notifies the user', async () => {
  const { svc, recorded } = make();
  const t = await svc.startThread(USER, 'OTHER'); // single free-text step
  await svc.answerBot(USER, t.id, 'My referral bonus is missing.'); // escalates immediately

  const msg = await svc.agentReply(AGENT, t.id, 'Hi, I’m looking into your bonus now.');
  assert.equal(msg.sender, 'AGENT');
  assert.equal(msg.senderId, AGENT);

  const open = await svc.listOpenThreads(AGENT);
  const joined = open.find((x) => x.id === t.id)!;
  assert.equal(joined.status, 'AGENT_JOINED');
  assert.equal(joined.agentId, AGENT);

  assert.ok(recorded.some((r) => r.userId === USER), 'the thread owner was notified');
});

test('a job-scoped (#6) thread carries its jobId and is resumable with full history', async () => {
  const { svc } = make();
  const t = await svc.startThread(USER, 'DELIVERY_ISSUE', 'job-42');
  assert.equal(t.jobId, 'job-42');

  await svc.answerBot(USER, t.id, 'Rider never showed up');
  await svc.answerBot(USER, t.id, 'Still not delivered');
  await svc.answerBot(USER, t.id, 'Waited an hour, no rider came.');
  await svc.postMessage(USER, t.id, 'Any update please?');

  // Re-open from the inbox: the thread is listed and its whole history is intact.
  const inbox = await svc.listMyThreads(USER);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.jobId, 'job-42');

  const history = await svc.listMessages(USER, t.id);
  const userLines = history.filter((m) => m.sender === 'USER').length;
  assert.equal(userLines, 4, 'all four user turns are preserved');
  assert.equal(history[0]!.sender, 'BOT', 'the opening bot prompt is still first');
});

test('resolveThread marks the conversation resolved', async () => {
  const { svc } = make();
  const t = await svc.startThread(USER, 'OTHER');
  await svc.answerBot(USER, t.id, 'done');
  const resolved = await svc.resolveThread(AGENT, t.id);
  assert.equal(resolved.status, 'RESOLVED');
});
