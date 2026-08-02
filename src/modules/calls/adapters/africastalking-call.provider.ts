import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { CallProvider, PlaceCallResult } from '../call-provider.port.js';

interface AtCallResponse {
  entries?: Array<{ phoneNumber?: string; status?: string; sessionId?: string }>;
  errorMessage?: string;
}

/**
 * Africa's Talking Voice adapter. Places the first (caller) leg of a masked call; the bridge to the
 * counterparty happens when AT calls our voice callback back (handled by the service, not here).
 *
 * `enabled()` is false unless credentials AND a caller-ID number are configured, so the app cleanly
 * falls back to direct dialing in dev / before the AT account is live.
 */
@Injectable()
export class AfricasTalkingCallProvider implements CallProvider {
  private readonly log = new Logger(AfricasTalkingCallProvider.name);
  private readonly username: string;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly base: string;

  constructor(@Inject(ENV) env: Env) {
    this.username = env.AT_USERNAME;
    this.apiKey = env.AT_API_KEY;
    this.from = env.AT_VOICE_NUMBER;
    this.base = env.AT_VOICE_BASE_URL.replace(/\/+$/, '');
  }

  enabled(): boolean {
    return Boolean(this.username && this.apiKey && this.from);
  }

  callerId(): string | null {
    return this.from || null;
  }

  async placeCall({ to, clientRequestId }: { to: string; clientRequestId: string }): Promise<PlaceCallResult> {
    const body = new URLSearchParams({ username: this.username, from: this.from, to, clientRequestId });
    let json: AtCallResponse = {};
    try {
      const res = await fetch(`${this.base}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          apiKey: this.apiKey,
        },
        body: body.toString(),
      });
      json = (await res.json().catch(() => ({}))) as AtCallResponse;
    } catch (err) {
      // Never surface provider/network detail to the client; log server-side only.
      this.log.error(`AT placeCall failed: ${(err as Error).message}`);
      return { sessionId: null, status: 'ProviderUnavailable' };
    }
    const entry = json.entries?.[0];
    if (!entry?.sessionId || (entry.status && entry.status !== 'Queued')) {
      this.log.warn(`AT call not queued: ${entry?.status ?? json.errorMessage ?? 'Unknown'}`);
      return { sessionId: null, status: entry?.status ?? json.errorMessage ?? 'Failed' };
    }
    return { sessionId: entry.sessionId, status: entry.status ?? 'Queued' };
  }
}
