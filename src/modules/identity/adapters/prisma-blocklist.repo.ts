import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { IdentityBlocklistRepository } from '../domain/identity-blocklist.port.js';

@Injectable()
export class PrismaBlocklistRepo implements IdentityBlocklistRepository {
  constructor(private readonly db: PrismaService) {}
  async isBlocked(h: { ninHash?: string; bvnHash?: string; deviceHash?: string }): Promise<boolean> {
    const or: object[] = [];
    if (h.ninHash) or.push({ ninHash: h.ninHash });
    if (h.bvnHash) or.push({ bvnHash: h.bvnHash });
    if (h.deviceHash) or.push({ deviceHash: h.deviceHash });
    if (or.length === 0) return false;
    return (await this.db.identityBlocklist.count({ where: { OR: or } })) > 0;
  }
  async block(e: { ninHash?: string; bvnHash?: string; deviceHash?: string; reason: string }): Promise<void> {
    await this.db.identityBlocklist.create({
      data: { ninHash: e.ninHash ?? null, bvnHash: e.bvnHash ?? null, deviceHash: e.deviceHash ?? null, reason: e.reason },
    });
  }
}
