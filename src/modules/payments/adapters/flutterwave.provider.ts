import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ProxyAgent } from 'undici';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import { Money } from '../domain/money.js';
import type { Bank, CollectionInit, PaymentProvider, VerifiedTxn } from '../payment-provider.interface.js';
import type { BankDirectory } from '../bank-directory.port.js';

const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

/**
 * A provider failure that is safe to return to the client (generic 503 message) while carrying the
 * detailed provider reason in `providerReason` for logs/ops only. The detailed reason is NEVER put
 * in the HttpException body, so it can't leak to the client through the global exception filter.
 */
export class PaymentProviderError extends ServiceUnavailableException {
  readonly providerReason: string;
  constructor(providerReason: string) {
    super('Payment provider unavailable');
    this.providerReason = providerReason;
  }
}

/**
 * Flutterwave v3 adapter. Escrow model: collect into our balance (Standard checkout),
 * confirm via verified webhook, then Transfer to the rider (release) or Refund the
 * transaction (refund). Fail-closed: any non-2xx / network error throws.
 */
@Injectable()
export class FlutterwaveProvider implements PaymentProvider, BankDirectory {
  private readonly log = new Logger(FlutterwaveProvider.name);
  private readonly secret: string;
  private readonly webhookSecret: string;
  private readonly base: string;
  // Comma-separated checkout methods (Flutterwave `payment_options`), or '' to show all enabled.
  private readonly paymentOptions: string;
  // When a proxy is configured, every Flutterwave request egresses through its dedicated IPv4 (the
  // one whitelisted in the Flutterwave dashboard), so Transfers/payouts are accepted.
  private readonly dispatcher?: RequestInit['dispatcher'];

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.FLW_SECRET_KEY;
    this.webhookSecret = env.FLW_WEBHOOK_SECRET;
    this.base = env.FLW_BASE_URL;
    this.paymentOptions = env.FLW_PAYMENT_OPTIONS.trim();
    this.dispatcher = env.FLW_PROXY_URL
      ? (this.buildProxyAgent(env.FLW_PROXY_URL) as unknown as RequestInit['dispatcher'])
      : undefined;
  }

  /**
   * Build a ProxyAgent from a proxy URL, forwarding any `user:pass@` credentials as a Proxy-
   * Authorization header (undici doesn't always derive this from the URL). A hosted proxy must
   * require auth so it isn't an open relay, so this path is the norm in production.
   */
  private buildProxyAgent(proxyUrl: string): ProxyAgent {
    const u = new URL(proxyUrl);
    const uri = `${u.protocol}//${u.host}`;
    if (u.username) {
      const creds = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
      const token = `Basic ${Buffer.from(creds).toString('base64')}`;
      return new ProxyAgent({ uri, token });
    }
    return new ProxyAgent({ uri });
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
      // Restrict the checkout to methods that actually work. Omitted entirely when empty so
      // Flutterwave falls back to showing every enabled method.
      ...(this.paymentOptions ? { payment_options: this.paymentOptions } : {}),
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
    const reference = flwReference(p.reference);
    const body = await this.call('POST', '/transfers', {
      account_bank: p.bankCode,
      account_number: p.accountNumber,
      amount: p.amount.amount / 100,
      currency: 'NGN',
      reference,
      narration: p.narration ?? 'Rydafirst rider payout',
    });
    return { providerRef: String(body?.data?.id ?? reference) };
  }

  async refund(p: { transactionId: string; amount: Money; reference?: string }): Promise<{ providerRef: string }> {
    const body = await this.call('POST', `/transactions/${encodeURIComponent(p.transactionId)}/refund`, {
      amount: p.amount.amount / 100,
      // Included for providers/endpoints that honour an idempotency reference; harmless otherwise.
      ...(p.reference ? { reference: flwReference(p.reference) } : {}),
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

  async listBanks(): Promise<Bank[]> {
    const body = await this.call('GET', '/banks/NG');
    const rows: unknown[] = Array.isArray(body?.data) ? body.data : [];
    const banks = rows
      .map((b) => {
        const r = b as { code?: unknown; name?: unknown };
        return { code: String(r.code ?? '').trim(), name: String(r.name ?? '').trim() };
      })
      .filter((b) => b.code.length > 0 && b.name.length > 0);
    // De-dupe by code (Flutterwave occasionally repeats) and sort alphabetically for the picker.
    const seen = new Set<string>();
    const unique = banks.filter((b) => (seen.has(b.code) ? false : (seen.add(b.code), true)));
    unique.sort((a, b) => a.name.localeCompare(b.name));
    return unique;
  }

  verifyWebhookSignature(signatureHeader: string): boolean {
    const enc = new TextEncoder();
    const a = enc.encode(signatureHeader ?? '');
    const b = enc.encode(this.webhookSecret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private async call(method: 'GET' | 'POST', path: string, payload?: object): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const init: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
          signal: ctrl.signal,
          ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        };
        const res = await fetch(`${this.base}${path}`, init);
        clearTimeout(timer);
        if (!res.ok) {
          // Capture the provider's own error reason (e.g. "insufficient balance", "invalid
          // account") so ops can tell a provider-side failure from ours. Server-side only.
          const detail = await this.extractError(res);
          throw new Error(`Flutterwave ${method} ${path} -> ${res.status}: ${detail}`);
        }
        return await res.json();
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (method === 'POST') break; // don't retry writes automatically (idempotency handled upstream)
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
    this.log.error(`Flutterwave call failed: ${reason}`);
    // Client gets a generic 503; the detailed reason rides along in `providerReason` for logs/ops.
    throw new PaymentProviderError(reason);
  }

  /** Best-effort read of the provider's JSON `{message}` for diagnostics; never throws. */
  private async extractError(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: unknown } | null;
      const msg = body && typeof body === 'object' && typeof body.message === 'string' ? body.message : '';
      return msg || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}

/**
 * Coerce an internal idempotency reference into one Flutterwave accepts.
 *
 * Flutterwave rejects a transfer/refund `reference` containing anything outside
 * [letters, numbers, underscore, dash] — and our internal keys use ':' as a separator
 * (`settle:<jobId>:v1:rider`). Every disallowed character maps to '_'.
 *
 * MUST be deterministic: the same input always yields the same output, so a retry re-issues the
 * SAME reference and Flutterwave de-dupes it. A non-deterministic transform here (a timestamp, a
 * random suffix) would break idempotency and could pay a rider twice.
 */
export function flwReference(ref: string): string {
  return ref.replace(/[^A-Za-z0-9_-]/g, '_');
}
