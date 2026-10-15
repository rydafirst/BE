import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ReferralRecord, ReferralRepository } from '../ports.js';

/** DEV/tests: referrals held in memory. */
@Injectable()
export class InMemoryReferralRepo implements ReferralRepository {
  private byId = new Map<string, ReferralRecord>();

  async create(input: { referrerId: string; refereeId: string }): Promise<ReferralRecord> {
    const rec: ReferralRecord = {
      id: randomUUID(),
      referrerId: input.referrerId,
      refereeId: input.refereeId,
      rewardMinor: 0,
      status: 'PENDING',
      createdAt: Date.now(),
    };
    this.byId.set(rec.id, rec);
    return { ...rec };
  }
  async findByReferee(refereeId: string): Promise<ReferralRecord | null> {
    for (const r of this.byId.values()) if (r.refereeId === refereeId) return { ...r };
    return null;
  }
  async listByReferrer(referrerId: string): Promise<ReferralRecord[]> {
    return [...this.byId.values()].filter((r) => r.referrerId === referrerId).map((r) => ({ ...r }));
  }
  async listAll(): Promise<ReferralRecord[]> {
    return [...this.byId.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ ...r }));
  }
  async get(id: string): Promise<ReferralRecord | null> {
    const r = this.byId.get(id);
    return r ? { ...r } : null;
  }
  async update(id: string, patch: Partial<Omit<ReferralRecord, 'id'>>): Promise<ReferralRecord> {
    const r = this.byId.get(id);
    if (!r) throw new Error('referral not found');
    const next = { ...r, ...patch };
    this.byId.set(id, next);
    return { ...next };
  }
}
