import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { OtpSender } from '../ports.js';

/**
 * SMS OTP delivery via Termii (Nigeria-focused, good local deliverability).
 * Fail-closed: if the send fails, we throw so the request errors and the user can retry —
 * we never pretend an OTP was delivered. Times out fast so a stuck provider can't hang login.
 */
@Injectable()
export class TermiiOtpSender implements OtpSender {
  private readonly log = new Logger('TermiiOtpSender');

  constructor(private readonly env: Env) {}

  async send(phone: string, code: string): Promise<void> {
    const to = phone.replace(/[^\d]/g, ''); // Termii wants digits only, international format
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${this.env.TERMII_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          to,
          from: this.env.TERMII_SENDER_ID,
          sms: `Your Rydafirst code is ${code}. It expires shortly. Do not share it with anyone.`,
          type: 'plain',
          channel: 'generic',
          api_key: this.env.TERMII_API_KEY,
        }),
      });
      if (!res.ok) {
        // Log status only — never log the code or full provider response (may echo the message).
        this.log.error(`Termii send failed: HTTP ${res.status}`);
        throw new ServiceUnavailableException('Could not send verification code, please try again');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.error(`Termii send error: ${(err as Error).name}`);
      throw new ServiceUnavailableException('Could not send verification code, please try again');
    } finally {
      clearTimeout(timeout);
    }
  }
}
