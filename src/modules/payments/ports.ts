import type { LedgerEntry } from './domain/ledger.js';
import type { IdempotencyRecord } from './domain/idempotency.js';

import type { EscrowTotals } from './domain/reconciliation.js';

export interface LedgerRepository {
  /** Append a balanced set of entries atomically (one DB transaction in prod). */
  append(entries: readonly LedgerEntry[]): Promise<void>;
  /** Derived escrow totals for reconciliation. */
  totals(): Promise<EscrowTotals>;
  /** Sum of CREDITs to an account across the given jobs (minor units). */
  sumCreditForJobs(account: string, jobIds: readonly string[]): Promise<number>;
  /** Global sum of CREDITs to an account (minor units) — e.g. total platform revenue. */
  sumCredit(account: string): Promise<number>;
}
export const LEDGER_REPO = Symbol('LEDGER_REPO');

export interface IdempotencyStore {
  get<T>(key: string): Promise<IdempotencyRecord<T> | null>;
  put<T>(key: string, result: T): Promise<void>;
  /**
   * Atomically reserve a key before doing side-effectful work. Returns true only for the caller
   * that created the reservation; every concurrent caller gets false. This is the lock that makes
   * a check-then-act money operation (e.g. settle) race-safe: exactly one worker proceeds.
   */
  claim(key: string): Promise<boolean>;
  /** Overwrite a reserved key with the final result once the work has completed. */
  complete<T>(key: string, result: T): Promise<void>;
}
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** Sentinel stored by `claim` before a result exists, so `get` can tell "in progress" from "done". */
export const IDEMPOTENCY_PENDING = { __pending: true } as const;
export function isPendingRecord(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { __pending?: unknown }).__pending === true;
}

export interface WebhookInboxStore {
  seen(eventId: string): Promise<boolean>;
  mark(eventId: string): Promise<void>;
}
export const WEBHOOK_INBOX = Symbol('WEBHOOK_INBOX');
