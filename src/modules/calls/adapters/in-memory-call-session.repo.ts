import { Injectable } from '@nestjs/common';
import type { CallSession, CallSessionStatus } from '../domain/call-session.js';
import type { CallSessionRepository } from '../call-session.repo.port.js';

/** Dev/test store. Same contract as the Postgres adapter. */
@Injectable()
export class InMemoryCallSessionRepo implements CallSessionRepository {
  private byId = new Map<string, CallSession>();

  async create(session: CallSession): Promise<void> {
    this.byId.set(session.id, { ...session });
  }

  async setProviderRef(id: string, providerRef: string, status: CallSessionStatus): Promise<void> {
    const s = this.byId.get(id);
    if (s) { s.providerRef = providerRef; s.status = status; }
  }

  async setStatus(id: string, status: CallSessionStatus): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.status = status;
  }

  async findByProviderRef(providerRef: string): Promise<CallSession | null> {
    for (const s of this.byId.values()) if (s.providerRef === providerRef) return { ...s };
    return null;
  }

  async complete(id: string, durationSec: number, cost?: { amount: string; currency: string }): Promise<void> {
    const s = this.byId.get(id);
    if (!s) return;
    s.status = 'COMPLETED';
    s.durationSec = durationSec;
    if (cost) { s.costAmount = cost.amount; s.costCurrency = cost.currency; }
  }
}
