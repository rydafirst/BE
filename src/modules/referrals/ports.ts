export type ReferralStatus = 'PENDING' | 'CREDITED' | 'REJECTED';

export interface ReferralRecord {
  id: string;
  referrerId: string;
  refereeId: string;
  rewardMinor: number; // snapshotted at credit time
  status: ReferralStatus;
  createdAt: number; // epoch ms
  creditedAt?: number;
  creditedBy?: string;
  payoutRef?: string;
  payoutError?: string;
}

export interface ReferralRepository {
  create(input: { referrerId: string; refereeId: string }): Promise<ReferralRecord>;
  /** A new rider has at most one referral (the code they entered at sign-up). */
  findByReferee(refereeId: string): Promise<ReferralRecord | null>;
  listByReferrer(referrerId: string): Promise<ReferralRecord[]>;
  listAll(): Promise<ReferralRecord[]>;
  get(id: string): Promise<ReferralRecord | null>;
  update(id: string, patch: Partial<Omit<ReferralRecord, 'id'>>): Promise<ReferralRecord>;
}

export const REFERRAL_REPO = Symbol('REFERRAL_REPO');
