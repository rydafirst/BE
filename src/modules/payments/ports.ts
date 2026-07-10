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
}
export const LEDGER_REPO = Symbol('LEDGER_REPO');

export interface IdempotencyStore {
  get<T>(key: string): Promise<IdempotencyRecord<T> | null>;
  put<T>(key: string, result: T): Promise<void>;
}
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

export interface WebhookInboxStore {
  seen(eventId: string): Promise<boolean>;
  mark(eventId: string): Promise<void>;
}
export const WEBHOOK_INBOX = Symbol('WEBHOOK_INBOX');
