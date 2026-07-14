import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { sanitizeMessageBody } from './domain/message.js';
import { MESSAGE_REPO, type ChatMessage, type MessageRepo } from './ports.js';

const HISTORY_LIMIT = 200;

/**
 * Rider–customer chat, scoped to a single job. Authorization is delegated to JobsService.getJob,
 * which throws unless the caller is that job's customer or assigned rider — so no third party can
 * ever read or post to a conversation they aren't part of.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(MESSAGE_REPO) private readonly repo: MessageRepo,
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
}
