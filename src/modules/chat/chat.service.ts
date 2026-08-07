import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { sanitizeMessageBody } from './domain/message.js';
import { chatCounterparty, chatNotification } from './domain/notify.js';
import { MESSAGE_REPO, REPORT_REPO, type ChatMessage, type MessageRepo, type MessageReport, type ReportRepo } from './ports.js';

const HISTORY_LIMIT = 200;
const MAX_REASON_LEN = 300;

/**
 * Rider–customer chat, scoped to a single job. Authorization is delegated to JobsService.getJob,
 * which throws unless the caller is that job's customer or assigned rider — so no third party can
 * ever read or post to a conversation they aren't part of.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(MESSAGE_REPO) private readonly repo: MessageRepo,
    @Inject(REPORT_REPO) private readonly reports: ReportRepo,
    private readonly jobs: JobsService,
    private readonly notify: NotificationsService,
  ) {}

  async list(actorId: string, jobId: string): Promise<ChatMessage[]> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    return this.repo.listForJob(jobId, HISTORY_LIMIT);
  }

  async post(actorId: string, jobId: string, rawBody: unknown): Promise<ChatMessage> {
    const job = await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    let body: string;
    try {
      body = sanitizeMessageBody(rawBody);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid message');
    }
    const msg = await this.repo.add({ jobId, senderId: actorId, body });

    // Tell the *other* party a message arrived. Best-effort and fail-closed: a push failure must
    // never fail the send, and the counterparty is derived server-side (the IDOR guard) so we can
    // only ever notify the one other participant. The push carries no message text.
    const counterparty = chatCounterparty(job, actorId);
    if (counterparty) {
      try { await this.notify.record(counterparty, { ...chatNotification(), jobId, urgent: true }); }
      catch { /* notifications are best-effort — the message is already stored */ }
    }
    return msg;
  }

  /**
   * Flag an abusive/objectionable message for platform review (App Store Guideline 1.2). Party-only,
   * and a user can't report their own message. The report is stored for the platform's moderation
   * queue; the reporter gets a simple acknowledgement.
   */
  async report(actorId: string, jobId: string, messageId: string, rawReason?: string): Promise<MessageReport> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    const msg = await this.repo.find(jobId, messageId);
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId === actorId) throw new BadRequestException('You cannot report your own message');
    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON_LEN) : undefined;
    return this.reports.add({ jobId, messageId, reporterId: actorId, ...(reason ? { reason } : {}) });
  }
}
