import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import { Money } from '../domain/money.js';
import type { CollectionInit, PaymentProvider, VerifiedTxn } from '../payment-provider.interface.js';

/**
 * DEV ONLY. Simulates Flutterwave so the app runs without keys.
 * initCollection returns a link straight back to the redirect URL flagged successful,
 * so local testing can complete the collect->fund path without a real payment page.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  private readonly webhookSecret: string;
  private readonly amounts = new Map<string, number>();

  constructor(@Inject(ENV) env: Env) {
    this.webhookSecret = env.FLW_WEBHOOK_SECRET;
  }

  async initCollection(p: CollectionInit): Promise<{ txRef: string; link: string }> {
    const txRef = `fake_${p.jobId}`;
    this.amounts.set(txRef, p.amount.amount);
    const link = `${p.redirectUrl}?status=successful&tx_ref=${txRef}&transaction_id=${txRef}`;
    return { txRef, link };
  }

  async verifyTransaction(transactionId: string): Promise<VerifiedTxn> {
    return {
      status: 'successful',
      amountMinor: this.amounts.get(transactionId) ?? 0,
      currency: 'NGN',
      txRef: transactionId,
      transactionId,
    };
  }

  async transfer(): Promise<{ providerRef: string }> {
    return { providerRef: `fake_transfer_${randomUUID().slice(0, 8)}` };
  }

  async refund(): Promise<{ providerRef: string }> {
    return { providerRef: `fake_refund_${randomUUID().slice(0, 8)}` };
  }

  verifyWebhookSignature(signatureHeader: string): boolean {
    return signatureHeader === this.webhookSecret;
  }
}
