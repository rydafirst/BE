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
  /** Name enquiry: resolve the account holder's name for a bank + account number. */
  resolveAccount(p: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>;
  /** Verify a webhook's `verif-hash` header against the configured secret. */
  verifyWebhookSignature(signatureHeader: string): boolean;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
