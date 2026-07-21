import { Inject, Injectable } from '@nestjs/common';
import type { CallableContact, ContactChannel } from '../../jobs/contact-channel.port.js';
import { USER_REPO, type UserRepository } from '../ports.js';

/**
 * Hands out the counterparty's real phone number.
 *
 * Interim implementation. The caller (JobsService) has already checked that these two users are the
 * parties to this job and that the job is still in flight, so exposure is scoped — but the number is
 * real, which means it outlives the delivery on the caller's phone. Replace with a proxy-number
 * adapter (`masked: true`) before opening the platform up beyond controlled testing; no client
 * change is needed when that happens.
 */
@Injectable()
export class DirectContactChannel implements ContactChannel {
  constructor(@Inject(USER_REPO) private readonly users: UserRepository) {}

  async numberFor(params: { jobId: string; callerUserId: string; subjectUserId: string }): Promise<CallableContact> {
    return { number: await this.users.getPhone(params.subjectUserId), masked: false };
  }
}
