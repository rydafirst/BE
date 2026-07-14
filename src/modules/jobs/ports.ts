import type { JobStatus } from './domain/job-state-machine.js';
import type { JobType } from './domain/fare.js';
import type { GeoPoint } from './domain/geo.js';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  customerId: string;
  amountMinor: number;         // total the customer paid (incl. platform fee)
  platformFeeMinor?: number;   // the platform's cut, split out to platform revenue on release
  currency: 'NGN';
  riderId?: string;
  refundAccountId: string;
  payoutPending?: boolean;     // rider transfer failed and is awaiting retry
  payoutError?: string;        // last provider reason for a failed payout (ops only)
  payoutRef?: string;          // provider ref once the payout succeeds
  pickup: GeoPoint;
  dropoff: GeoPoint;
  pickupAddress?: string;   // full label (revealed to rider after accept)
  dropoffAddress?: string;
  pickupArea?: string;      // coarse neighbourhood (e.g. "Ikeja") shown in the pre-accept feed
  dropoffArea?: string;
  recipient?: { name: string; phone: string };
  item?: string;
  weightGrams?: number;   // approximate item weight (shown to the rider for clarity)
  instructions?: string;
  fallbackPolicy?: 'WAIT' | 'DELEGATE' | 'RETURN';
  flwTxRef?: string;
  flwTxId?: string;
  createdAt: string;
  arrivedAt?: number; // epoch ms the rider was verified at the drop-off (for waiting-fee metering)
  waitStartedAt?: number;   // epoch ms the rider started the wait timer (10-min free grace, then metered)
  returnOfJobId?: string;   // set on a return leg -> the original delivery it returns to the sender
  waitingTxRef?: string;    // payment ref for the separate metered waiting-fee collection
  waitingTxId?: string;     // provider txn id once the waiting fee is funded (held in escrow)
  waitingFeeMinor?: number; // the accrued waiting fee charged to the sender (100% to the rider)
  returnReserveMinor?: number; // pre-charged 75% "return insurance" held in escrow (RETURN policy)
}

export interface JobRepository {
  create(job: Job): Promise<void>;
  find(id: string): Promise<Job | null>;
  updateStatus(id: string, status: JobStatus): Promise<void>;
  /** Atomically assign a rider ONLY if the job is still SEARCHING (first accept wins). */
  claim(id: string, riderId: string): Promise<boolean>;
  /** Release an accepted job back to the pool: clear the rider and set status back to SEARCHING. */
  release(id: string): Promise<void>;
  listActive(): Promise<Job[]>;
  listByRider(riderId: string): Promise<Job[]>;
  listByCustomer(customerId: string): Promise<Job[]>;
  /** Most recent jobs across the platform (admin monitoring), newest first. */
  listRecent(limit: number): Promise<Job[]>;
  findByTxRef(txRef: string): Promise<Job | null>;
  setPaymentRefs(id: string, refs: { txRef?: string; txId?: string }): Promise<void>;
  setArrivedAt(id: string, atMs: number): Promise<void>;
  /** Record when the rider started the wait timer (drives the free-grace + metered waiting fee). */
  setWaitStartedAt(id: string, atMs: number): Promise<void>;
  /** Record the separate waiting-fee charge (ref/txn id/amount) collected from the sender. */
  setWaitingRefs(id: string, refs: { txRef?: string; txId?: string; feeMinor?: number }): Promise<void>;
  /** Record the outcome of the rider payout so a failed transfer can be retried later. */
  setPayoutState(id: string, state: { pending: boolean; error?: string | null; ref?: string | null }): Promise<void>;
  /** Jobs whose rider payout still needs to be retried (ops + scheduled retry). */
  listPayoutPending(limit: number): Promise<Job[]>;
}
export const JOB_REPO = Symbol('JOB_REPO');
