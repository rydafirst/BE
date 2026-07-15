import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { sanitizeMessageBody } from './domain/message.js';
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
  ) {}

  async list(actorId: string, jobId: string): Promise<ChatMessage[]> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    return this.repo.listForJob(jobId, HISTORY_LIMIT);
  }

  async post(actorId: string, jobId: string, rawBody: unknown): Promise<ChatMessage> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    let body: string;
    try {
      body = sanitizeMessageBody(rawBody);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid message');
    }
    return this.repo.add({ jobId, senderId: actorId, body });
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
