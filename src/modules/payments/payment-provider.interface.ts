import { Money } from './domain/money.js';

export interface CollectionInit {
  jobId: string;
  amount: Money;
  customerEmail: string;
  customerName?: string;
  redirectUrl: string;
}

export interface VerifiedTxn {
  status: 'successful' | 'failed' | 'pending';
  amountMinor: number;
  currency: string;
  txRef: string;        // our reference (tx_ref)
  transactionId: string; // provider transaction id (for refunds)
}

/** A bank the user can pick by name; `code` is the processor's bank code used for transfers. */
export interface Bank {
  code: string;
  name: string;
}

/**
 * Current state of a bank transfer at the processor. Transfers are ASYNC: the initial create returns
 * a queued state and the terminal outcome (success/failure) lands later. This lets ops read the real
 * status on demand rather than trusting the initial "accepted".
 */
export interface TransferStatus {
  /** Processor status, upper-cased (e.g. NEW, PENDING, SUCCESSFUL, FAILED, UNKNOWN). */
  status: string;
  /** Processor's completion/failure message, if any (e.g. "Transaction was successful"). */
  reason?: string;
  reference?: string;
  amountMinor?: number;
}

/**
 * Abstraction over the licensed processor (Flutterwave). Escrow = collect into our balance,
 * hold (don't pay the rider yet), then transfer on release / refund on failure.
 */
export interface PaymentProvider {
  /** Create a hosted-checkout payment; returns the link to redirect the customer to. */
  initCollection(p: CollectionInit): Promise<{ txRef: string; link: string }>;
  /** Server-side verify a transaction (defense-in-depth after the webhook). */
  verifyTransaction(transactionId: string): Promise<VerifiedTxn>;
  /** Release: pay the rider by bank transfer. */
  transfer(p: {
    amount: Money; bankCode: string; accountNumber: string; reference: string; narration?: string;
  }): Promise<{ providerRef: string }>;
  /** Refund a collection back to the customer's source. `reference` is a stable idempotency key. */
  refund(p: { transactionId: string; amount: Money; reference?: string }): Promise<{ providerRef: string }>;
  /** Fetch a transfer's current status by its processor id/reference (transfers settle asynchronously). */
  getTransfer(idOrReference: string): Promise<TransferStatus>;
  /** Name enquiry: resolve the account holder's name for a bank + account number. */
  resolveAccount(p: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>;
  /** Verify a webhook's `verif-hash` header against the configured secret. */
  verifyWebhookSignature(signatureHeader: string): boolean;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
