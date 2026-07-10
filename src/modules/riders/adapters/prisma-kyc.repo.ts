import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { KycStatus } from '../domain/kyc-state.js';
import type { KycRecord, KycRepository } from '../kyc.ports.js';

@Injectable()
export class PrismaKycRepo implements KycRepository {
  constructor(private readonly db: PrismaService) {}
  async get(riderId: string): Promise<KycRecord | null> {
    const r = await this.db.rider.findUnique({ where: { userId: riderId } });
    if (!r) return null;
    return {
      riderId, status: r.kycStatus,
      inputs: {
        ninVerified: r.ninVerified, bvnVerified: r.bvnVerified, idDocUploaded: r.idDocUploaded,
        selfieMatched: r.selfieMatched, addressProvided: r.addressProvided,
      },
    };
  }
  async upsert(rec: KycRecord): Promise<void> {
    const data = {
      kycStatus: rec.status, ninVerified: rec.inputs.ninVerified, bvnVerified: rec.inputs.bvnVerified,
      idDocUploaded: rec.inputs.idDocUploaded, selfieMatched: rec.inputs.selfieMatched, addressProvided: rec.inputs.addressProvided,
    };
    await this.db.rider.upsert({ where: { userId: rec.riderId }, update: data, create: { userId: rec.riderId, ...data } });
  }
  async listByStatus(status: KycStatus): Promise<KycRecord[]> {
    const rows: Array<{ userId: string; kycStatus: string; ninVerified: boolean; bvnVerified: boolean; idDocUploaded: boolean; selfieMatched: boolean; addressProvided: boolean }> =
      await this.db.rider.findMany({ where: { kycStatus: status } });
    return rows.map((r) => ({
      riderId: r.userId, status: r.kycStatus as KycStatus,
      inputs: { ninVerified: r.ninVerified, bvnVerified: r.bvnVerified, idDocUploaded: r.idDocUploaded, selfieMatched: r.selfieMatched, addressProvided: r.addressProvided },
    }));
  }
}
