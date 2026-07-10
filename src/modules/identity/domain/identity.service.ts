import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { HmacHasher } from '../../../common/security/hmac-hasher.js';
import { IDENTITY_BLOCKLIST_REPO, type IdentityBlocklistRepository } from './identity-blocklist.port.js';

/**
 * Checks a would-be registrant against the theft blocklist and bans identities.
 * NIN/BVN/device are hashed (peppered HMAC) before they ever touch storage.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly hasher: HmacHasher,
    @Inject(IDENTITY_BLOCKLIST_REPO) private readonly repo: IdentityBlocklistRepository,
  ) {}

  private hashes(input: { nin?: string; bvn?: string; deviceId?: string }): {
    ninHash?: string;
    bvnHash?: string;
    deviceHash?: string;
  } {
    const out: { ninHash?: string; bvnHash?: string; deviceHash?: string } = {};
    if (input.nin) out.ninHash = this.hasher.hash(input.nin);
    if (input.bvn) out.bvnHash = this.hasher.hash(input.bvn);
    if (input.deviceId) out.deviceHash = this.hasher.hash(input.deviceId);
    return out;
  }

  /** Called at signup/KYC. Fail-closed: a blocked identity cannot register. */
  async assertNotBlocked(input: { nin?: string; bvn?: string; deviceId?: string }): Promise<void> {
    const blocked = await this.repo.isBlocked(this.hashes(input));
    if (blocked) throw new ForbiddenException('Registration not permitted');
  }

  /** Called on confirmed theft. Permanently bans the identity + device. */
  async banIdentity(input: { nin?: string; bvn?: string; deviceId?: string; reason: string }): Promise<void> {
    await this.repo.block({ ...this.hashes(input), reason: input.reason });
  }
}
