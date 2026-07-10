import type { KycInputs, KycStatus } from './domain/kyc-state.js';

export interface KycRecord {
  riderId: string;
  status: KycStatus;
  inputs: KycInputs;
}

export interface KycRepository {
  get(riderId: string): Promise<KycRecord | null>;
  upsert(record: KycRecord): Promise<void>;
  listByStatus(status: KycStatus): Promise<KycRecord[]>;
}
export const KYC_REPO = Symbol('KYC_REPO');
