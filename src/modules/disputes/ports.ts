import type { DisputeStatus, Resolution } from './domain/dispute.js';

export interface DisputeRecord {
  id: string;
  jobId: string;
  openedBy: string;
  status: DisputeStatus;
  tier: 'auto' | 'manual';
  resolution?: Resolution;
  createdAt: string;
  resolvedAt?: string;
}

export interface DisputeRepository {
  create(d: DisputeRecord): Promise<void>;
  find(id: string): Promise<DisputeRecord | null>;
  update(id: string, patch: Partial<DisputeRecord>): Promise<void>;
  /** All disputes, newest first (admin review list). */
  list(): Promise<DisputeRecord[]>;
}
export const DISPUTE_REPO = Symbol('DISPUTE_REPO');
