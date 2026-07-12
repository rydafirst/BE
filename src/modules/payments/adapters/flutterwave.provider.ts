import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import { Money } from '../domain/money.js';
import type { CollectionInit, PaymentProvider, VerifiedTxn } from '../payment-provider.interface.js';

const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

/**
 * Flutterwave v3 adapter. Escrow model: collect into our balance (Standard checkout),
 * confirm via verified webhook, then Transfer to the rider (release) or Refund the
 * transaction (refund). Fail-closed: any non-2xx / network error throws.
 */
@Injectable()
export class FlutterwaveProvider implements PaymentProvider {
  private readonly log = new Logger(FlutterwaveProvider.name);
  private readonly secret: string;
  private readonly webhookSecret: string;
  private readonly base: string;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.FLW_SECRET_KEY;
    this.webhookSecret = env.FLW_WEBHOOK_SECRET;
    this.base = env.FLW_BASE_URL;
  }

  async initCollection(p: CollectionInit): Promise<{ txRef: string; link: string }> {
    const txRef = `rf_${p.jobId}_${randomUUID().slice(0, 8)}`;
    const body = await this.call('POST', '/payments', {
      tx_ref: txRef,
      amount: p.amount.amount / 100, // provider expects major units (naira)
      currency: 'NGN',
      redirect_url: p.redirectUrl,
      customer: { email: p.customerEmail, name: p.customerName ?? 'Customer' },
      customizations: { title: 'Rydafirst', description: `Delivery ${p.jobId}` },
      meta: { jobId: p.jobId },
    });
    const link = body?.data?.link as string | undefined;
    if (!link) throw new ServiceUnavailableException('No payment link returned');
    return { txRef, link };
  }

  async verifyTransaction(transactionId: string): Promise<VerifiedTxn> {
    const body = await this.call('GET', `/transactions/${encodeURIComponent(transactionId)}/verify`);
    const d = body?.data ?? {};
    return {
      status: d.status === 'successful' ? 'successful' : d.status === 'failed' ? 'failed' : 'pending',
      amountMinor: Math.round(Number(d.amount ?? 0) * 100),
      currency: String(d.currency ?? 'NGN'),
      txRef: String(d.tx_ref ?? ''),
      transactionId: String(d.id ?? transactionId),
    };
  }

  async transfer(p: {
    amount: Money; bankCode: string; accountNumber: string; reference: string; narration?: string;
  }): Promise<{ providerRef: string }> {
    const body = await this.call('POST', '/transfers', {
      account_bank: p.bankCode,
      account_number: p.accountNumber,
      amount: p.amount.amount / 100,
      currency: 'NGN',
      reference: p.reference,
      narration: p.narration ?? 'Rydafirst rider payout',
    });
    return { providerRef: String(body?.data?.id ?? p.reference) };
  }

  async refund(p: { transactionId: string; amount: Money }): Promise<{ providerRef: string }> {
    const body = await this.call('POST', `/transactions/${encodeURIComponent(p.transactionId)}/refund`, {
      amount: p.amount.amount / 100,
    });
    return { providerRef: String(body?.data?.id ?? p.transactionId) };
  }

  async resolveAccount(p: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }> {
    const body = await this.call('POST', '/accounts/resolve', {
      account_number: p.accountNumber,
      account_bank: p.bankCode,
    });
    const name = body?.data?.account_name as string | undefined;
    if (!name) throw new ServiceUnavailableException('Could not resolve account name');
    return { accountName: name };
  }

  verifyWebhookSignature(signatureHeader: string): boolean {
    const a = Buffer.from(signatureHeader ?? '');
    const b = Buffer.from(this.webhookSecret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private async call(method: 'GET' | 'POST', path: string, payload?: object): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${this.base}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Flutterwave ${method} ${path} -> ${res.status}`);
        return await res.json();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (method === 'POST') break; // don't retry writes automatically (idempotency handled upstream)
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
    this.log.error(`Flutterwave call failed: ${String(lastErr)}`);
    throw new ServiceUnavailableException('Payment provider unavailable');
  }
}
