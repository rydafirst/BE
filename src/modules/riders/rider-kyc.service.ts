import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { canApproveKyc, canKycTransition, type KycInputs, type KycRecord } from './domain/kyc-state.js';
import { KYC_REPO, type KycRepository } from './kyc.ports.js';

@Injectable()
export class RiderKycService {
  constructor(@Inject(KYC_REPO) private readonly repo: KycRepository) {}

  /** Rider submits KYC for review. */
  async submit(riderId: string, inputs: KycInputs): Promise<KycRecord> {
    const cur = await this.repo.get(riderId);
    const from = cur?.status ?? 'UNSUBMITTED';
    if (!canKycTransition(from, 'PENDING')) throw new ConflictException('KYC cannot be resubmitted in current state');
    const record: KycRecord = { riderId, status: 'PENDING', inputs };
    await this.repo.upsert(record);
    return record;
  }

  listPending(): Promise<KycRecord[]> {
    return this.repo.listByStatus('PENDING');
  }

  /** Admin decision. Approval requires all identity requirements (NIN+BVN etc.) satisfied. */
  async decide(riderId: string, approve: boolean): Promise<KycRecord> {
    const cur = await this.repo.get(riderId);
    if (!cur) throw new BadRequestException('No KYC on file');
    const to = approve ? 'APPROVED' : 'REJECTED';
    if (!canKycTransition(cur.status, to)) throw new ConflictException(`Cannot move KYC ${cur.status} -> ${to}`);
    if (approve && !canApproveKyc(cur.inputs)) throw new ConflictException('Identity requirements not satisfied (NIN/BVN)');
    const updated: KycRecord = { ...cur, status: to };
    await this.repo.upsert(updated);
    return updated;
  }
}
