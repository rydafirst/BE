import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import { Money } from '../domain/money.js';
import type { Bank, CollectionInit, PaymentProvider, VerifiedTxn } from '../payment-provider.interface.js';
import type { BankDirectory } from '../bank-directory.port.js';

// A small but realistic Nigerian bank list for dev/testing — includes the fintechs
// (Opay, Kuda, PalmPay, Moniepoint) whose codes people most often get wrong.
const DEV_BANKS: Bank[] = [
  { code: '044', name: 'Access Bank' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank (FCMB)' },
  { code: '058', name: 'Guaranty Trust Bank (GTBank)' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '50515', name: 'Moniepoint MFB' },
  { code: '999992', name: 'Opay (OPay Digital Services)' },
  { code: '999991', name: 'PalmPay' },
  { code: '076', name: 'Polaris Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
].sort((a, b) => a.name.localeCompare(b.name));

/**
 * DEV ONLY. Simulates Flutterwave so the app runs without keys.
 * initCollection returns a link straight back to the redirect URL flagged successful,
 * so local testing can complete the collect->fund path without a real payment page.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider, BankDirectory {
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

  async resolveAccount(p: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }> {
    // DEV: return a deterministic placeholder so the resolve-name flow works without real keys.
    return { accountName: `Test Account ${p.accountNumber.slice(-4)}` };
  }

  async listBanks(): Promise<Bank[]> {
    return DEV_BANKS;
  }

  verifyWebhookSignature(signatureHeader: string): boolean {
    return signatureHeader === this.webhookSecret;
  }
}
