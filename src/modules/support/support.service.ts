import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sanitizeMessageBody } from '../chat/domain/message.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  botOpeningPrompt, botStep, escalate, isFlowComplete, isSupportCategory,
  type SupportCategory,
} from './domain/support.js';
import {
  SUPPORT_REPO, type SupportMessage, type SupportRepo, type SupportThread,
} from './ports.js';

const HISTORY_LIMIT = 200;
const OPEN_LIMIT = 100;

/**
 * Automated support chat with human agent hand-off (launch items #5 and #6).
 *
 * A thread starts in the BOT state and runs a short scripted funnel (see domain/support.ts). When the
 * user finishes describing their issue the thread escalates to AWAITING_AGENT under a 30-minute SLA and
 * support admins are notified. An agent then replies (moving it to AGENT_JOINED) and the user is
 * notified. Threads carrying a `jobId` are per-trip (#6) and are fully resumable — re-opening shows the
 * whole history.
 *
 * Authorization: users can only ever touch their OWN threads; the agent-side methods are guarded at the
 * controller by the `admin:support:manage` permission (the new SUPPORT scope). Notifications are always
 * best-effort and never carry message text.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(SUPPORT_REPO) private readonly repo: SupportRepo,
    private readonly notify: NotificationsService,
  ) {}

  /** Support admins to alert on escalation: SUPPORT_ADMIN_IDS (comma-separated user ids), else none. */
  private supportAdminIds(): string[] {
    return (process.env.SUPPORT_ADMIN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /** Start a new support thread and seed the bot's opening prompt. `jobId` makes it a per-trip thread (#6). */
  async startThread(userId: string, rawCategory: unknown, jobId?: string): Promise<SupportThread> {
    if (!isSupportCategory(rawCategory)) throw new BadRequestException('Unknown support category');
    const category: SupportCategory = rawCategory;
    const thread = await this.repo.createThread({
      userId, category, status: 'BOT', ...(jobId ? { jobId } : {}),
    });
    await this.repo.addMessage({ threadId: thread.id, sender: 'BOT', body: botOpeningPrompt(category) });
    return thread;
  }

  /**
   * Advance the bot funnel: record the user's answer (a tapped choice or free text), then either ask
   * the next scripted question or — when the flow completes — escalate to a human agent and notify
   * support admins.
   */
  async answerBot(userId: string, threadId: string, rawAnswer: unknown): Promise<{ thread: SupportThread; messages: SupportMessage[] }> {
    const thread = await this.ownThread(userId, threadId);
    if (thread.status !== 'BOT') throw new BadRequestException('This conversation has already reached an agent');

    let body: string;
    try {
      body = sanitizeMessageBody(rawAnswer);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid answer');
    }

    // The step the user just answered = how many USER messages already exist. After this answer the
    // funnel advances to `nextStep`.
    const existing = await this.repo.listMessages(threadId, HISTORY_LIMIT);
    const answeredSoFar = existing.filter((m) => m.sender === 'USER').length;
    const nextStep = answeredSoFar + 1;

    await this.repo.addMessage({ threadId, sender: 'USER', senderId: userId, body });

    if (isFlowComplete(thread.category, nextStep)) {
      const escalated = escalate(thread, Date.now());
      const updated = await this.repo.setStatus(threadId, escalated.status, escalated.agentJoinDeadline);
      await this.repo.addMessage({
        threadId, sender: 'BOT',
        body: 'Thank you. Your issue has been sent to our support team — an agent will join within 30 minutes.',
      });
      await this.notifyAdmins();
      return { thread: updated, messages: await this.repo.listMessages(threadId, HISTORY_LIMIT) };
    }

    const next = botStep(thread.category, nextStep);
    if (next) await this.repo.addMessage({ threadId, sender: 'BOT', body: next.prompt });
    return { thread, messages: await this.repo.listMessages(threadId, HISTORY_LIMIT) };
  }

  /** A free-text message from the user on their own thread (sanitized). */
  async postMessage(userId: string, threadId: string, rawBody: unknown): Promise<SupportMessage> {
    await this.ownThread(userId, threadId);
    let body: string;
    try {
      body = sanitizeMessageBody(rawBody);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid message');
    }
    return this.repo.addMessage({ threadId, sender: 'USER', senderId: userId, body });
  }

  /** The user's support inbox — every thread they own, newest first (resumable, #6). */
  listMyThreads(userId: string): Promise<SupportThread[]> {
    return this.repo.listByUser(userId);
  }

  /** Full history of one of the user's own threads (own-only). */
  async listMessages(userId: string, threadId: string): Promise<SupportMessage[]> {
    await this.ownThread(userId, threadId);
    return this.repo.listMessages(threadId, HISTORY_LIMIT);
  }

  // ---- Agent side (guarded by admin:support:manage at the controller) ----

  /** The agent queue: threads waiting for or in progress with an agent, longest-waiting first. */
  listOpenThreads(_agentId: string): Promise<SupportThread[]> {
    return this.repo.listOpen(OPEN_LIMIT);
  }

  /** Agent messages for any thread by id (agents are trusted staff; no per-user ownership check). */
  async listThreadForAgent(_agentId: string, threadId: string): Promise<{ thread: SupportThread; messages: SupportMessage[] }> {
    const thread = await this.mustFind(threadId);
    return { thread, messages: await this.repo.listMessages(threadId, HISTORY_LIMIT) };
  }

  /**
   * An agent joins/replies: assign the agent, move the thread to AGENT_JOINED, append the reply, and
   * notify the thread's user (best-effort, no message text in the push).
   */
  async agentReply(agentId: string, threadId: string, rawBody: unknown): Promise<SupportMessage> {
    const thread = await this.mustFind(threadId);
    if (thread.status === 'RESOLVED') throw new BadRequestException('This conversation is already resolved');
    let body: string;
    try {
      body = sanitizeMessageBody(rawBody);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid message');
    }
    await this.repo.assignAgent(threadId, agentId);
    await this.repo.setStatus(threadId, 'AGENT_JOINED');
    const msg = await this.repo.addMessage({ threadId, sender: 'AGENT', senderId: agentId, body });
    try {
      await this.notify.record(thread.userId, {
        title: 'Support replied',
        body: 'An agent has replied to your support request.',
        ...(thread.jobId ? { jobId: thread.jobId } : {}),
        urgent: true,
      });
    } catch { /* notifications are best-effort — the reply is already stored */ }
    return msg;
  }

  /** Mark a thread resolved (agent-side). */
  async resolveThread(_agentId: string, threadId: string): Promise<SupportThread> {
    await this.mustFind(threadId);
    return this.repo.setStatus(threadId, 'RESOLVED');
  }

  // ---- helpers ----

  private async mustFind(threadId: string): Promise<SupportThread> {
    const thread = await this.repo.findThread(threadId);
    if (!thread) throw new NotFoundException('Support thread not found');
    return thread;
  }

  /** Load a thread and assert the caller owns it (own-only guard for user endpoints). */
  private async ownThread(userId: string, threadId: string): Promise<SupportThread> {
    const thread = await this.mustFind(threadId);
    if (thread.userId !== userId) throw new ForbiddenException();
    return thread;
  }

  /** Alert support admins that a thread is waiting for an agent. Best-effort; no issue text in push. */
  private async notifyAdmins(): Promise<void> {
    for (const adminId of this.supportAdminIds()) {
      try {
        await this.notify.record(adminId, {
          title: 'New support request',
          body: 'A customer is waiting for an agent to join (30-minute SLA).',
          urgent: true,
        });
      } catch { /* best-effort — escalation already persisted */ }
    }
  }
}
