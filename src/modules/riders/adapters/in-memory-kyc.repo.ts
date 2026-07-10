import { Injectable } from '@nestjs/common';
import type { KycStatus } from '../domain/kyc-state.js';
import type { KycRecord, KycRepository } from '../kyc.ports.js';

// DEV ONLY. Replace with Postgres + real NIN/BVN verification in the persistence phase.
@Injectable()
export class InMemoryKycRepo implements KycRepository {
  private m = new Map<string, KycRecord>();
  async get(riderId: string): Promise<KycRecord | null> { return this.m.get(riderId) ?? null; }
  async upsert(r: KycRecord): Promise<void> { this.m.set(r.riderId, { ...r }); }
  async listByStatus(status: KycStatus): Promise<KycRecord[]> {
    return [...this.m.values()].filter((r) => r.status === status);
  }
}
