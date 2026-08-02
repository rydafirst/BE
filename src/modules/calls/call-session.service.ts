import { randomUUID } from 'node:crypto';
import { BadGatewayException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { JOB_REPO, type JobRepository } from '../jobs/ports.js';
import { contactAllowed } from '../jobs/domain/contact-window.js';
import { USER_REPO, RATE_LIMITER, type UserRepository, type RateLimiter } from '../auth/ports.js';
import { CALL_PROVIDER, type CallProvider } from './call-provider.port.js';
import { CALL_SESSION_REPO, type CallSessionRepository } from './call-session.repo.port.js';
import {
  CALL_MAX_SECONDS,
  CALL_SESSION_TTL_MS,
  buildDialXml,
  buildEmptyXml,
  buildRejectXml,
  isBridgeable,
  type CallSession,
} from './domain/call-session.js';

/** Max call initiations per job+caller inside the window (anti-harassment / toll-fraud cap). */
const CALL_RATE_LIMIT = 5;
const CALL_RATE_WINDOW_SEC = 600;

/**
 * Orchestrates masked calls: authorize the initiator, place the caller leg through the provider,
 * and on the provider's callback either bridge to the counterparty or politely reject. Real phone
 * numbers only ever move between this service and the provider — never to a client.
 */
@Injectable()
export class CallSessionService {
  constructor(
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
    @Inject(USER_REPO) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(CALL_PROVIDER) private readonly provider: CallProvider,
    @Inject(CALL_SESSION_REPO) private readonly sessions: CallSessionRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Masking is live only when the provider is configured AND we can authenticate its callback. */
  enabled(): boolean {
    return this.provider.enabled() && Boolean(this.env.VOICE_CALLBACK_SECRET);
  }

  callbackSecret(): string {
    return this.env.VOICE_CALLBACK_SECRET;
  }

  /**
   * Start a masked call from `callerUserId` to the other party of the job. Rings the caller first;
   * the bridge is completed by the provider callback once they answer.
   */
  async initiate({ jobId, callerUserId }: { jobId: string; callerUserId: string }): Promise<{ status: 'ringing' }> {
    if (!this.enabled()) throw new ConflictException('In-app calling is not available');

    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundException('Delivery not found');

    // Party check (fine-grained authz beyond coarse RBAC): only the two account holders may call.
    let counterpartyUserId: string | undefined;
    if (callerUserId === job.customerId) counterpartyUserId = job.riderId;
    else if (job.riderId && callerUserId === job.riderId) counterpartyUserId = job.customerId;
    else throw new ForbiddenException('You are not part of this delivery');
    if (!counterpartyUserId) throw new ConflictException('No rider is assigned to call yet');

    if (!contactAllowed(job.status)) throw new ConflictException('Calling is closed for this delivery');

    const allowed = await this.limiter.hit(`call:init:${jobId}:${callerUserId}`, CALL_RATE_LIMIT, CALL_RATE_WINDOW_SEC);
    if (!allowed) throw new ConflictException('Too many call attempts — please wait a moment');

    const callerPhone = await this.users.getPhone(callerUserId);
    const counterpartyPhone = await this.users.getPhone(counterpartyUserId);
    if (!callerPhone || !counterpartyPhone) throw new ConflictException('A phone number is missing for this call');

    const now = Date.now();
    const session: CallSession = {
      id: randomUUID(),
      jobId,
      initiatorUserId: callerUserId,
      counterpartyUserId,
      provider: 'africastalking',
      status: 'PENDING',
      createdAt: now,
      expiresAt: now + CALL_SESSION_TTL_MS,
    };
    await this.sessions.create(session);

    const result = await this.provider.placeCall({ to: callerPhone, clientRequestId: session.id });
    if (!result.sessionId) {
      await this.sessions.setStatus(session.id, 'FAILED');
      throw new BadGatewayException('Could not place the call — please try again');
    }
    await this.sessions.setProviderRef(session.id, result.sessionId, 'RINGING');
    return { status: 'ringing' };
  }

  /**
   * Provider voice callback while the call is active (the initiator has answered). Returns the XML
   * that bridges them to the counterparty, or a reject when the session is stale / the window closed.
   */
  async handleAnswer(providerSessionId: string): Promise<string> {
    const session = await this.sessions.findByProviderRef(providerSessionId);
    if (!session || !isBridgeable(session, Date.now())) {
      return buildRejectXml('Sorry, this call can no longer be connected.');
    }

    const job = await this.jobs.find(session.jobId);
    if (!job || !contactAllowed(job.status)) {
      await this.sessions.setStatus(session.id, 'EXPIRED');
      return buildRejectXml('This delivery has ended.');
    }

    const toNumber = await this.users.getPhone(session.counterpartyUserId);
    const callerId = this.provider.callerId();
    if (!toNumber || !callerId) {
      await this.sessions.setStatus(session.id, 'FAILED');
      return buildRejectXml('The other party is unavailable right now.');
    }

    await this.sessions.setStatus(session.id, 'CONNECTED');
    return buildDialXml(toNumber, callerId, CALL_MAX_SECONDS);
  }

  /** Provider's final callback (isActive=0): record duration/cost and close the session. */
  async handleFinal(providerSessionId: string, durationSec: number, cost?: { amount: string; currency: string }): Promise<string> {
    const session = await this.sessions.findByProviderRef(providerSessionId);
    if (session) await this.sessions.complete(session.id, durationSec, cost);
    return buildEmptyXml();
  }
}
