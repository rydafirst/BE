import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Money } from './domain/money.js';
import { computeSettlement, type SettlementOutcome } from './domain/refund.js';
import { buildHoldPosting, buildSettlementPosting } from './domain/escrow-posting.js';
import { decideIdempotency, opKey } from './domain/idempotency.js';
import { decideWebhook } from './domain/webhook-inbox.js';
import { reconcile, type ReconciliationResult } from './domain/reconciliation.js';
import { canRefund, canRelease, type JobStatus } from '../jobs/domain/job-state-machine.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type VerifiedTxn } from './payment-provider.interface.js';
import {
  LEDGER_REPO, IDEMPOTENCY_STORE, WEBHOOK_INBOX,
  type LedgerRepository, type IdempotencyStore, type WebhookInboxStore,
} from './ports.js';

export interface RiderPayout { bankCode: string; accountNumber: string }

interface SettleParams {
  jobId: string;
  status: JobStatus;
  outcome: SettlementOutcome;
  collected: Money;
  attemptFee?: Money;
  riderShare?: Money;
  riderPayout?: RiderPayout;   // required to actually transfer to the rider
  transactionId?: string;      // the collection txn id, required to actually refund
}

/** The ONLY component that moves money. Guarded, idempotent, fail-closed. */
@Injectable()
export class EscrowService {
  private readonly log = new Logger(EscrowService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LEDGER_REPO) private readonly ledger: LedgerRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idem: IdempotencyStore,
    @Inject(WEBHOOK_INBOX) private readonly inbox: WebhookInboxStore,
  ) {}

  /** Start collection: returns the hosted-checkout link to redirect the customer to. */
  beginCollection(jobId: string, amount: Money, customerEmail: string, redirectUrl: string): Promise<{ txRef: string; link: string }> {
    return this.provider.initCollection({ jobId, amount, customerEmail, redirectUrl });
  }

  /** Confirm collected funds (called after a verified webhook). Posts the ledger hold once. */
  async confirmFunding(jobId: string, verified: VerifiedTxn): Promise<void> {
    const key = opKey('hold', jobId);
    if ((await this.idem.get(key)) !== null) return; // already funded (idempotent)
    await this.ledger.append(buildHoldPosting(jobId, Money.of(verified.amountMinor)));
    await this.idem.put(key, { transactionId: verified.transactionId, txRef: verified.txRef });
  }

  /**
   * Verify + dedupe a charge webhook. Returns the verified transaction (or 'duplicate').
   * Fail-closed: an unsigned/mismatched webhook throws before anything happens.
   */
  async processChargeWebhook(signatureHeader: string, transactionId: string): Promise<{ status: 'duplicate' } | { status: 'ok'; verified: VerifiedTxn }> {
    if (!this.provider.verifyWebhookSignature(signatureHeader)) {
      throw new ConflictException('Invalid webhook signature');
    }
    if (decideWebhook(await this.inbox.seen(transactionId)) === 'duplicate') return { status: 'duplicate' };
    const verified = await this.provider.verifyTransaction(transactionId);
    await this.inbox.mark(transactionId);
    return { status: 'ok', verified };
  }

  /** Verify a transaction directly with the provider (used by verify-on-return). */
  verifyTransaction(transactionId: string): Promise<VerifiedTxn> {
    return this.provider.verifyTransaction(transactionId);
  }

  /** Name enquiry for a bank + account number (so the client never types the account name). */
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
    return this.provider.resolveAccount({ bankCode, accountNumber });
  }

  /** Settle: release (transfer to rider) and/or refund (to customer source). */
  async settle(p: SettleParams): Promise<{ providerRef: string }> {
    this.assertOutcomeAllowed(p.status, p.outcome);

    const key = opKey('settle', p.jobId);
    const cached = decideIdempotency(await this.idem.get<{ providerRef: string }>(key));
    if (cached.action === 'return_cached') return cached.result;

    const settlement = computeSettlement({
      collected: p.collected,
      outcome: p.outcome,
      ...(p.attemptFee ? { attemptFee: p.attemptFee } : {}),
      ...(p.riderShare ? { riderShare: p.riderShare } : {}),
    });

    let providerRef = '';
    if (!settlement.toRider.isZero() && p.riderPayout) {
      const r = await this.provider.transfer({
        amount: settlement.toRider,
        bankCode: p.riderPayout.bankCode,
        accountNumber: p.riderPayout.accountNumber,
        reference: `${key}:rider`,
      });
      providerRef = r.providerRef;
    }
    if (!settlement.toCustomer.isZero() && p.transactionId) {
      const r = await this.provider.refund({ transactionId: p.transactionId, amount: settlement.toCustomer });
      providerRef = providerRef || r.providerRef;
    }

    await this.ledger.append(buildSettlementPosting(p.jobId, settlement));
    const result = { providerRef };
    await this.idem.put(key, result);
    return result;
  }

  async reconciliationView(): Promise<ReconciliationResult> {
    const ours = await this.ledger.totals();
    const provider = ours; // TODO(integration): fetch Flutterwave settlement report
    return reconcile(ours, provider);
  }

  /** Escrow money totals (minor units) for the admin finance view. */
  async escrowTotals(): Promise<{ held: number; released: number; refunded: number }> {
    const t = await this.ledger.totals();
    return { held: t.held.amount, released: t.released.amount, refunded: t.refunded.amount };
  }

  async releasedEarningsForJobs(jobIds: readonly string[]): Promise<number> {
    return this.ledger.sumCreditForJobs('RIDER_PAYABLE', jobIds);
  }

  private assertOutcomeAllowed(status: JobStatus, outcome: SettlementOutcome): void {
    const ok =
      outcome === 'RELEASE_FULL'
        ? canRelease(status) || status === 'DISPUTE_RESOLVED'
        : outcome === 'DISPUTE_SPLIT'
          ? status === 'DISPUTE_RESOLVED'
          : canRefund(status);
    if (!ok) throw new ConflictException(`Outcome ${outcome} not allowed from state ${status}`);
  }
}
