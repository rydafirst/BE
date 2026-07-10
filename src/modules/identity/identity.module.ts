import { Injectable, Module } from '@nestjs/common';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { IdentityService } from './domain/identity.service.js';
import { IDENTITY_BLOCKLIST_REPO, type IdentityBlocklistRepository } from './domain/identity-blocklist.port.js';
import { PrismaBlocklistRepo } from './adapters/prisma-blocklist.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Injectable()
class InMemoryBlocklistRepo implements IdentityBlocklistRepository {
  private set = new Set<string>();
  async isBlocked(h: { ninHash?: string; bvnHash?: string; deviceHash?: string }): Promise<boolean> {
    return [h.ninHash, h.bvnHash, h.deviceHash].some((x) => x && this.set.has(x));
  }
  async block(e: { ninHash?: string; bvnHash?: string; deviceHash?: string }): Promise<void> {
    for (const x of [e.ninHash, e.bvnHash, e.deviceHash]) if (x) this.set.add(x);
  }
}

@Module({
  providers: [
    IdentityService,
    HmacHasher,
    { provide: IDENTITY_BLOCKLIST_REPO, useClass: usePg ? PrismaBlocklistRepo : InMemoryBlocklistRepo },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
