import type { JobStatus } from './domain/job-state-machine.js';
import type { JobType } from './domain/fare.js';
import type { GeoPoint } from './domain/geo.js';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  customerId: string;
  amountMinor: number;
  currency: 'NGN';
  riderId?: string;
  refundAccountId: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  pickupAddress?: string;
  dropoffAddress?: string;
  recipient?: { name: string; phone: string };
  item?: string;
  instructions?: string;
  fallbackPolicy?: 'WAIT' | 'DELEGATE' | 'RETURN';
  flwTxRef?: string;
  flwTxId?: string;
  createdAt: string;
  arrivedAt?: number; // epoch ms the rider was verified at the drop-off (for waiting-fee metering)
}

export interface JobRepository {
  create(job: Job): Promise<void>;
  find(id: string): Promise<Job | null>;
  updateStatus(id: string, status: JobStatus): Promise<void>;
  /** Atomically assign a rider ONLY if the job is still SEARCHING (first accept wins). */
  claim(id: string, riderId: string): Promise<boolean>;
  listActive(): Promise<Job[]>;
  listByRider(riderId: string): Promise<Job[]>;
  listByCustomer(customerId: string): Promise<Job[]>;
  findByTxRef(txRef: string): Promise<Job | null>;
  setPaymentRefs(id: string, refs: { txRef?: string; txId?: string }): Promise<void>;
  setArrivedAt(id: string, atMs: number): Promise<void>;
}
export const JOB_REPO = Symbol('JOB_REPO');
