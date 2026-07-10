import { Injectable } from '@nestjs/common';
import type { LedgerEntry } from '../domain/ledger.js';
import type { IdempotencyRecord } from '../domain/idempotency.js';
import type { LedgerRepository, IdempotencyStore, WebhookInboxStore } from '../ports.js';
import { Money } from '../domain/money.js';
import { deriveBalance } from '../domain/ledger.js';
import type { EscrowTotals } from '../domain/reconciliation.js';

// DEV ONLY. Replace with Postgres (append-only ledger table + tx) and Redis inbox in persistence phase.

@Injectable()
export class InMemoryLedgerRepo implements LedgerRepository {
  readonly entries: LedgerEntry[] = [];
  async append(entries: readonly LedgerEntry[]): Promise<void> {
    // Immutable append (never mutate/delete existing rows).
    this.entries.push(...entries);
  }
  async sumCreditForJobs(account: string, jobIds: readonly string[]): Promise<number> {
    const set = new Set(jobIds);
    return this.entries
      .filter((e) => e.account === account && e.direction === 'CREDIT' && set.has(e.jobId))
      .reduce((sum, e) => sum + e.amount.amount, 0);
  }
  async totals(): Promise<EscrowTotals> {
    // held = escrow still credited net; released/refunded = amounts credited to those accounts.
    const released = deriveBalance(this.entries, 'RIDER_PAYABLE');
    const refunded = deriveBalance(this.entries, 'CUSTOMER_REFUND');
    let escrowNet = Money.zero();
    try { escrowNet = deriveBalance(this.entries, 'ESCROW'); } catch { escrowNet = Money.zero(); }
    return { held: escrowNet, released, refunded };
  }
}

@Injectable()
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> {
    return this.m.has(key) ? { key, result: this.m.get(key) as T } : null;
  }
  async put<T>(key: string, result: T): Promise<void> {
    if (!this.m.has(key)) this.m.set(key, result); // first write wins
  }
}

@Injectable()
export class InMemoryWebhookInbox implements WebhookInboxStore {
  private set = new Set<string>();
  async seen(eventId: string): Promise<boolean> { return this.set.has(eventId); }
  async mark(eventId: string): Promise<void> { this.set.add(eventId); }
}
