import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { JobsService } from '../jobs/jobs.service.js';
import { checkCode, generateCode } from './domain/confirmation-code.js';
import { CODE_REPO, type ConfirmationCodeRepository } from './ports.js';

@Injectable()
export class ConfirmationService {
  constructor(
    private readonly hasher: HmacHasher,
    private readonly jobs: JobsService,
    @Inject(CODE_REPO) private readonly codes: ConfirmationCodeRepository,
  ) {}

  /** Issue the receiver's single-use delivery code (delivered in-app; never a bank OTP). */
  async issueDeliveryCode(jobId: string): Promise<{ code: string }> {
    const code = generateCode();
    await this.codes.save(jobId, {
      kind: 'DELIVERY', codeHash: this.hasher.hash(code), createdAtMs: Date.now(), attempts: 0, consumed: false,
    });
    return { code }; // DEV returns it; prod pushes to the receiver's app.
  }

  /**
   * Rider submits the code. On success -> escrow release (via JobsService.completeDelivery).
   * The code is the release trigger; arrival geofence was already enforced at markArrived.
   */
  async confirmDelivery(riderId: string, jobId: string, code: string): Promise<{ status: string }> {
    const rec = await this.codes.find(jobId, 'DELIVERY');
    if (!rec) throw new UnauthorizedException('Invalid code'); // no enumeration

    const matches = this.hasher.verify(code, rec.codeHash);
    const res = checkCode(rec, matches, Date.now());
    if (!res.ok) {
      if (res.reason === 'mismatch') await this.codes.incrementAttempts(jobId, 'DELIVERY');
      throw new UnauthorizedException('Invalid code');
    }
    await this.codes.markConsumed(jobId, 'DELIVERY');
    return this.jobs.completeDelivery(riderId, jobId);
  }
}
