import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { ReferralRecord, ReferralRepository, ReferralStatus } from '../ports.js';

/** The generated client may lag a freshly-added model, so the delegate is reached through a loose cast. */
type ReferralRow = {
  id: string; referrerId: string; refereeId: string; rewardMinor: number; status: string;
  createdAt: Date; creditedAt: Date | null; creditedBy: string | null; payoutRef: string | null; payoutError: string | null;
};
type ReferralDelegate = {
  create(args: { data: { referrerId: string; refereeId: string } }): Promise<ReferralRow>;
  findUnique(args: { where: { refereeId: string } }): Promise<ReferralRow | null>;
  findFirst(args: { where: { id: string } }): Promise<ReferralRow | null>;
  findMany(args?: { where?: { referrerId?: string }; orderBy?: { createdAt: 'desc' } }): Promise<ReferralRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReferralRow>;
};

@Injectable()
export class PrismaReferralRepo implements ReferralRepository {
  constructor(private readonly db: PrismaService) {}
  private get t(): ReferralDelegate {
    return (this.db as unknown as { referral: ReferralDelegate }).referral;
  }
  private map(r: ReferralRow): ReferralRecord {
    return {
      id: r.id, referrerId: r.referrerId, refereeId: r.refereeId, rewardMinor: r.rewardMinor,
      status: r.status as ReferralStatus, createdAt: r.createdAt.getTime(),
      ...(r.creditedAt ? { creditedAt: r.creditedAt.getTime() } : {}),
      ...(r.creditedBy ? { creditedBy: r.creditedBy } : {}),
      ...(r.payoutRef ? { payoutRef: r.payoutRef } : {}),
      ...(r.payoutError ? { payoutError: r.payoutError } : {}),
    };
  }
  async create(input: { referrerId: string; refereeId: string }): Promise<ReferralRecord> {
    return this.map(await this.t.create({ data: { referrerId: input.referrerId, refereeId: input.refereeId } }));
  }
  async findByReferee(refereeId: string): Promise<ReferralRecord | null> {
    const r = await this.t.findUnique({ where: { refereeId } });
    return r ? this.map(r) : null;
  }
  async listByReferrer(referrerId: string): Promise<ReferralRecord[]> {
    return (await this.t.findMany({ where: { referrerId }, orderBy: { createdAt: 'desc' } })).map((r) => this.map(r));
  }
  async listAll(): Promise<ReferralRecord[]> {
    return (await this.t.findMany({ orderBy: { createdAt: 'desc' } })).map((r) => this.map(r));
  }
  async get(id: string): Promise<ReferralRecord | null> {
    const r = await this.t.findFirst({ where: { id } });
    return r ? this.map(r) : null;
  }
  async update(id: string, patch: Partial<Omit<ReferralRecord, 'id'>>): Promise<ReferralRecord> {
    const data: Record<string, unknown> = {};
    if (patch.rewardMinor !== undefined) data.rewardMinor = patch.rewardMinor;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.creditedAt !== undefined) data.creditedAt = new Date(patch.creditedAt);
    if (patch.creditedBy !== undefined) data.creditedBy = patch.creditedBy;
    if (patch.payoutRef !== undefined) data.payoutRef = patch.payoutRef;
    if (patch.payoutError !== undefined) data.payoutError = patch.payoutError ?? null;
    return this.map(await this.t.update({ where: { id }, data }));
  }
}
