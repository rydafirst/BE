import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { CallSession, CallSessionStatus } from '../domain/call-session.js';
import type { CallSessionRepository } from '../call-session.repo.port.js';

/** Shape of a CallSession row. Declared locally (like prisma-job.repo.ts) so this file typechecks
 *  whether or not the Prisma client has been regenerated for the new model. */
interface CallSessionRow {
  id: string;
  jobId: string;
  initiatorUserId: string;
  counterpartyUserId: string;
  provider: string;
  providerRef: string | null;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  durationSec: number | null;
  costAmount: string | null;
  costCurrency: string | null;
}

/** Minimal delegate surface we use, so the file compiles before `prisma generate` adds the model. */
interface CallSessionDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { where: { providerRef: string } }): Promise<CallSessionRow | null>;
}

function toDomain(r: CallSessionRow): CallSession {
  return {
    id: r.id,
    jobId: r.jobId,
    initiatorUserId: r.initiatorUserId,
    counterpartyUserId: r.counterpartyUserId,
    provider: r.provider,
    providerRef: r.providerRef ?? undefined,
    status: r.status as CallSessionStatus,
    createdAt: r.createdAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    durationSec: r.durationSec ?? undefined,
    costAmount: r.costAmount ?? undefined,
    costCurrency: r.costCurrency ?? undefined,
  };
}

@Injectable()
export class PrismaCallSessionRepo implements CallSessionRepository {
  constructor(private readonly db: PrismaService) {}

  private get table(): CallSessionDelegate {
    return (this.db as unknown as { callSession: CallSessionDelegate }).callSession;
  }

  async create(session: CallSession): Promise<void> {
    await this.table.create({
      data: {
        id: session.id,
        jobId: session.jobId,
        initiatorUserId: session.initiatorUserId,
        counterpartyUserId: session.counterpartyUserId,
        provider: session.provider,
        providerRef: session.providerRef ?? null,
        status: session.status,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      },
    });
  }

  async setProviderRef(id: string, providerRef: string, status: CallSessionStatus): Promise<void> {
    await this.table.update({ where: { id }, data: { providerRef, status } });
  }

  async setStatus(id: string, status: CallSessionStatus): Promise<void> {
    await this.table.update({ where: { id }, data: { status } });
  }

  async findByProviderRef(providerRef: string): Promise<CallSession | null> {
    const row = await this.table.findFirst({ where: { providerRef } });
    return row ? toDomain(row) : null;
  }

  async complete(id: string, durationSec: number, cost?: { amount: string; currency: string }): Promise<void> {
    await this.table.update({
      where: { id },
      data: { status: 'COMPLETED', durationSec, costAmount: cost?.amount ?? null, costCurrency: cost?.currency ?? null },
    });
  }
}
