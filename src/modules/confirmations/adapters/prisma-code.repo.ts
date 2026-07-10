import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { CodeKind, CodeRecord } from '../domain/confirmation-code.js';
import type { ConfirmationCodeRepository } from '../ports.js';

@Injectable()
export class PrismaCodeRepo implements ConfirmationCodeRepository {
  constructor(private readonly db: PrismaService) {}
  async save(jobId: string, r: CodeRecord): Promise<void> {
    await this.db.confirmationCode.upsert({
      where: { jobId_kind: { jobId, kind: r.kind } },
      update: { codeHash: r.codeHash, attempts: r.attempts, consumed: r.consumed, createdAt: new Date(r.createdAtMs) },
      create: { jobId, kind: r.kind, codeHash: r.codeHash, attempts: r.attempts, consumed: r.consumed, createdAt: new Date(r.createdAtMs) },
    });
  }
  async find(jobId: string, kind: CodeKind): Promise<CodeRecord | null> {
    const c = await this.db.confirmationCode.findUnique({ where: { jobId_kind: { jobId, kind } } });
    return c ? { kind: c.kind, codeHash: c.codeHash, createdAtMs: c.createdAt.getTime(), attempts: c.attempts, consumed: c.consumed } : null;
  }
  async incrementAttempts(jobId: string, kind: CodeKind): Promise<void> {
    await this.db.confirmationCode.update({ where: { jobId_kind: { jobId, kind } }, data: { attempts: { increment: 1 } } });
  }
  async markConsumed(jobId: string, kind: CodeKind): Promise<void> {
    await this.db.confirmationCode.update({ where: { jobId_kind: { jobId, kind } }, data: { consumed: true } });
  }
}
