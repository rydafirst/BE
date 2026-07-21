import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InlinePayoutDispatcher, PAYOUT_DISPATCHER, type PayoutDispatcher } from './payout-dispatcher.port.js';
import { Money } from './domain/money.js';
import { computeSettlement, type SettlementOutcome } from './domain/refund.js';
import { buildHoldPosting, buildSettlementPosting } from './domain/escrow-posting.js';
import { opKey } from './domain/idempotency.js';
import { decideWebhook } from './domain/webhook-inbox.js';
import { reconcile, type ReconciliationResult } from './domain/reconciliation.js';
import { canRefund, canRelease, type JobStatus } from '../jobs/domain/job-state-machine.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type VerifiedTxn } from './payment-provider.interface.js';
import {
  LEDGER_REPO, IDEMPOTENCY_STORE, WEBHOOK_INBOX, isPendingRecord,
  type LedgerRepository, type IdempotencyStore, type WebhookInboxStore,
} from './ports.js';

export interface RiderPayout { bankCode: string; accountNumber: string }

interface SettleParams {
  jobId: string;
  status: JobStatus;
  outcome: SettlementOutcome;
  collected: Money;
  platformFee?: Money;         // for RELEASE_FULL — the platform's cut, kept out of the payout
  attemptFee?: Money;
  riderShare?: Money;
  riderPayout?: RiderPayout;   // required to actually transfer to the rider
  transactionId?: string;      // the collection txn id, required to actually refund
  /**
   * Persist the payout outcome. Supplied by the caller so the money engine never needs to know about
   * jobs. Called once with the queued state and again with the real outcome when the disbursement is
   * deferred, so it must be a last-write-wins upsert. When supplied, the caller must NOT also write
   * payout state from the returned result — that would race the deferred update and overwrite it.
   */
  onPayoutSettled?: (result: SettleResult) => Promise<void>;
}

/** Reported while an external disbursement has been accepted but not yet attempted. */
export const PAYOUT_QUEUED = 'payout queued';

/**
 * Result of a settlement. The ledger release is durable regardless of `payoutPending`.
 * `payoutPending` means an external disbursement (rider transfer and/or customer refund)
 * could not complete and must be retried — it never blocks the delivery from completing.
 */
export interface SettleResult {
  providerRef: string;
  /** Per-leg provider references, recorded so a retry never re-issues a leg that already succeeded. */
  transferRef?: string;
  refundRef?: string;
  payoutPending: boolean;
  payoutError?: string;
}

/** Internal result of the best-effort external disbursement (per-leg refs + pending/error). */
interface DisburseResult { transferRef?: string; refundRef?: string; pending: boolean; error?: string }

/** The ONLY component that moves money. Guarded, idempotent, fail-closed. */
@Injectable()
export class EscrowService {
  private readonly log = new Logger(EscrowService.name);
  private readonly dispatcher: PayoutDispatcher;

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LEDGER_REPO) private readonly ledger: LedgerRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idem: IdempotencyStore,
    @Inject(WEBHOOK_INBOX) private readonly inbox: WebhookInboxStore,
    // Optional with an inline default: unwired construction (unit tests, scripts) keeps the exact
    // pre-existing synchronous behaviour, so deferring payouts is opt-in at the composition root.
    @Optional() @Inject(PAYOUT_DISPATCHER) dispatcher?: PayoutDispatcher,
  ) {
    this.dispatcher = dispatcher ?? new InlinePayoutDispatcher();
  }

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

  /**
   * Hold a separately-collected waiting surcharge for a job. Uses a distinct idempotency key
   * ('waiting') so it never collides with the main fare hold; posts the escrow hold exactly once.
   */
  async confirmWaitingFunding(jobId: string, verified: VerifiedTxn): Promise<void> {
    const key = opKey('hold', jobId, 'waiting');
    if ((await this.idem.get(key)) !== null) return; // already funded (idempotent)
    await this.ledger.append(buildHoldPosting(jobId, Money.of(verified.amountMinor)));
    await this.idem.put(key, { transactionId: verified.transactionId, txRef: verified.txRef });
  }

  /**
   * Release a funded waiting surcharge 100% to the rider (no platform cut — it's compensation for
   * their time). Durable + atomically idempotent under the 'waiting' settle key, so it can never
   * double-pay even if completion is retried.
   */
  async settleWaitingToRider(jobId: string, amount: Money, riderPayout?: RiderPayout): Promise<SettleResult> {
    return this.settleFixed(jobId, 'waiting', { toRider: amount, toPlatform: Money.zero(), toCustomer: Money.zero() }, riderPayout);
  }

  /**
   * Pre-declared "return insurance": on an actual return, release the pre-charged 75% reserve to the
   * rider as the return-leg payment (no platform cut here; the platform already earned on the fare).
   */
  async settleReturnReserveToRider(jobId: string, amount: Money, riderPayout?: RiderPayout): Promise<SettleResult> {
    return this.settleFixed(jobId, 'return', { toRider: amount, toPlatform: Money.zero(), toCustomer: Money.zero() }, riderPayout);
  }

  /** Pre-declared "return insurance": on a successful delivery, refund the unused 75% to the customer. */
  async refundReturnReserveToCustomer(jobId: string, amount: Money, transactionId?: string): Promise<SettleResult> {
    return this.settleFixed(jobId, 'return', { toRider: Money.zero(), toPlatform: Money.zero(), toCustomer: amount }, undefined, transactionId);
  }

  /**
   * Settle a FIXED, pre-computed split under a discriminated key (e.g. 'waiting', 'return'). Same
   * durable-ledger-then-best-effort-disburse contract as `settle`, with the atomic claim guard, so a
   * side settlement can never double-post or double-pay. Used for surcharges/reserves on a job whose
   * main fare is settled separately.
   */
  private async settleFixed(
    jobId: string,
    discriminator: string,
    settlement: { toRider: Money; toPlatform: Money; toCustomer: Money },
    riderPayout?: RiderPayout,
    transactionId?: string,
  ): Promise<SettleResult> {
    const key = opKey('settle', jobId, discriminator);
    const existing = await this.idem.get<SettleResult>(key);
    if (existing && !isPendingRecord(existing.result)) return existing.result;
    const won = await this.idem.claim(key);
    if (!won) {
      const now = await this.idem.get<SettleResult>(key);
      if (now && !isPendingRecord(now.result)) return now.result;
      throw new ConflictException('Settlement already in progress for this job');
    }
    await this.ledger.append(buildSettlementPosting(jobId, settlement));
    return this.disburseAndRecord(key, settlement, riderPayout, transactionId);
  }

  /** Name enquiry for a bank + account number (so the client never types the account name). */
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
    return this.provider.resolveAccount({ bankCode, accountNumber });
  }

  /**
   * Settle a job. The ledger release (our source of truth: escrow → rider payable + platform
   * revenue + customer refund) is written FIRST and durably. Only then do we attempt the external
   * bank transfer / card refund — best-effort and idempotent. A provider failure never throws up to
   * strand the delivery; it returns payoutPending=true so the caller can flag the job for retry.
   */
  async settle(p: SettleParams): Promise<SettleResult> {
    this.assertOutcomeAllowed(p.status, p.outcome);

    const key = opKey('settle', p.jobId);

    // Fast path: already settled -> return the stored result (idempotent replay).
    const existing = await this.idem.get<SettleResult>(key);
    if (existing && !isPendingRecord(existing.result)) return existing.result;

    // Atomic reservation: exactly ONE concurrent caller wins the claim and may post the ledger.
    // This is what makes settle race-safe — no two callers can double-post or double-transfer.
    const won = await this.idem.claim(key);
    if (!won) {
      const now = await this.idem.get<SettleResult>(key);
      if (now && !isPendingRecord(now.result)) return now.result;
      // Another worker holds the claim and hasn't finished yet: signal a safe retry, never proceed.
      throw new ConflictException('Settlement already in progress for this job');
    }

    const settlement = computeSettlement({
      collected: p.collected,
      outcome: p.outcome,
      ...(p.platformFee ? { platformFee: p.platformFee } : {}),
      ...(p.attemptFee ? { attemptFee: p.attemptFee } : {}),
      ...(p.riderShare ? { riderShare: p.riderShare } : {}),
    });

    // 1) DURABLE, no external I/O — release is recorded in the ledger, split three ways.
    await this.ledger.append(buildSettlementPosting(p.jobId, settlement));

    // 2) BEST-EFFORT external disbursement — never throws; failures become payoutPending. Whether
    //    this runs inline or after the response is the dispatcher's call, not ours.
    return this.disburseAndRecord(key, settlement, p.riderPayout, p.transactionId, p.onPayoutSettled);
  }

  /**
   * Run the external disbursement through the dispatcher and persist whatever outcome comes back.
   *
   * The ledger is already durable by the time this is called, so every path here is recoverable:
   * the worst case is a job left flagged `payoutPending`, which is exactly what the admin retry
   * queue consumes. Nothing below can lose money — it can only delay it.
   */
  private async disburseAndRecord(
    key: string,
    settlement: { toRider: Money; toCustomer: Money },
    riderPayout?: RiderPayout,
    transactionId?: string,
    onPayoutSettled?: (result: SettleResult) => Promise<void>,
  ): Promise<SettleResult> {
    const persist = async (result: SettleResult): Promise<void> => {
      await this.idem.complete(key, result);
      if (onPayoutSettled) await onPayoutSettled(result);
    };
    return this.dispatcher.execute(
      async () => this.toResult(await this.disburse(key, settlement, riderPayout, transactionId)),
      persist,
      { providerRef: '', payoutPending: true, payoutError: PAYOUT_QUEUED },
    );
  }

  /**
   * Re-attempt only the external disbursement for an already-released job (the ledger is untouched).
   * Idempotent: the rider transfer reuses the same provider reference so it can never double-pay.
   *
   * Deliberately NOT routed through the dispatcher: this is the admin "Retry payout" button, and the
   * operator pressing it needs the real answer in the response, not "queued".
   */
  async retryDisbursement(p: SettleParams): Promise<SettleResult> {
    const key = opKey('settle', p.jobId);
    // Read the last recorded refs so we NEVER re-issue a leg that already succeeded (a retry after a
    // refund/transfer that actually went through but was recorded as pending due to a response blip).
    const cached = await this.idem.get<SettleResult>(key);
    const prior = cached && !isPendingRecord(cached.result) ? cached.result : undefined;

    const settlement = computeSettlement({
      collected: p.collected,
      outcome: p.outcome,
      ...(p.platformFee ? { platformFee: p.platformFee } : {}),
      ...(p.attemptFee ? { attemptFee: p.attemptFee } : {}),
      ...(p.riderShare ? { riderShare: p.riderShare } : {}),
    });
    const disbursed = await this.disburse(key, settlement, p.riderPayout, p.transactionId, prior);
    const result = this.toResult(disbursed);
    await this.idem.complete(key, result); // persist any newly-succeeded leg refs
    return result;
  }

  private toResult(d: DisburseResult): SettleResult {
    return {
      providerRef: d.transferRef || d.refundRef || '',
      ...(d.transferRef ? { transferRef: d.transferRef } : {}),
      ...(d.refundRef ? { refundRef: d.refundRef } : {}),
      payoutPending: d.pending,
      ...(d.error ? { payoutError: d.error } : {}),
    };
  }

  /**
   * Attempt the rider transfer + customer refund. Catches provider errors so a failure is a pending
   * flag, not a thrown exception. Idempotency is enforced two ways: the rider transfer uses a stable
   * reference (idempotent at the PSP), and BOTH legs are skipped if `prior` already holds a success
   * ref for them — so a retry can never double-pay or double-refund.
   */
  private async disburse(
    key: string,
    settlement: { toRider: Money; toCustomer: Money },
    riderPayout?: RiderPayout,
    transactionId?: string,
    prior?: { transferRef?: string; refundRef?: string },
  ): Promise<DisburseResult> {
    let transferRef = prior?.transferRef;
    let refundRef = prior?.refundRef;
    let pending = false;
    let error: string | undefined;

    if (!settlement.toRider.isZero() && !transferRef) {
      if (!riderPayout) {
        // Money is owed to the rider but we have no bank account to send it to. NEVER silently drop
        // it — flag it pending so it surfaces in the finance retry queue and can be paid once the
        // rider adds an account (rather than the ledger showing "released" with no disbursement).
        pending = true;
        error = 'rider has no payout account on file';
        this.log.error(`Rider payout skipped for ${key}: no payout account on file`);
      } else {
        try {
          const r = await this.provider.transfer({
            amount: settlement.toRider,
            bankCode: riderPayout.bankCode,
            accountNumber: riderPayout.accountNumber,
            reference: `${key}:rider`, // stable ⇒ idempotent at the PSP
          });
          transferRef = r.providerRef;
        } catch (e) {
          pending = true;
          error = reasonOf(e, 'transfer failed');
          this.log.error(`Rider payout failed for ${key}: ${error}`);
        }
      }
    }
    if (!settlement.toCustomer.isZero() && transactionId && !refundRef) {
      try {
        const r = await this.provider.refund({
          transactionId,
          amount: settlement.toCustomer,
          reference: `${key}:refund`, // stable ⇒ idempotent for providers that honour it
        });
        refundRef = r.providerRef;
      } catch (e) {
        pending = true;
        error = reasonOf(e, 'refund failed');
        this.log.error(`Customer refund failed for ${key}: ${error}`);
      }
    }
    return {
      ...(transferRef ? { transferRef } : {}),
      ...(refundRef ? { refundRef } : {}),
      pending,
      ...(error ? { error } : {}),
    };
  }

  async reconciliationView(): Promise<ReconciliationResult> {
    const ours = await this.ledger.totals();
    const provider = ours; // TODO(integration): fetch Flutterwave settlement report
    return reconcile(ours, provider);
  }

  /** Escrow money totals (minor units) for the admin finance view, incl. total platform revenue. */
  async escrowTotals(): Promise<{ held: number; released: number; refunded: number; platformRevenue: number }> {
    const [t, platformRevenue] = await Promise.all([this.ledger.totals(), this.ledger.sumCredit('PLATFORM_FEE')]);
    return { held: t.held.amount, released: t.released.amount, refunded: t.refunded.amount, platformRevenue };
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

/**
 * Ops-facing failure reason. Prefers a provider's detailed `providerReason` (e.g. "insufficient
 * balance") over the generic HttpException message, so the payout record tells ops whether the
 * failure was provider-side or ours. This value is stored on the Job (admin only), never sent to
 * the client.
 */
function reasonOf(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const pr = (e as { providerReason?: unknown }).providerReason;
    if (typeof pr === 'string' && pr.length > 0) return pr;
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}
