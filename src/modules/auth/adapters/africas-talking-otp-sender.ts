import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Env } from '../../../config/env.validation.js';
import { toNgE164 } from '../../../common/phone.js';
import type { OtpSender } from '../ports.js';

/**
 * SMS OTP delivery via Africa's Talking — the alternate SMS provider to Termii.
 * Selected when SMS_PROVIDER=africastalking (with OTP_CHANNEL=sms). Uses the same AT credentials
 * as voice masking (AT_USERNAME/AT_API_KEY) plus AT_SMS_SENDER_ID for the branded sender.
 *
 * Fail-closed: we throw unless AT confirms the message was accepted for delivery (recipient
 * statusCode 100/101/102). A stuck provider is bounded by a short timeout so it can't hang login.
 * We never log the code or full provider response.
 */
@Injectable()
export class AfricasTalkingOtpSender implements OtpSender {
  private readonly log = new Logger('AfricasTalkingOtpSender');

  constructor(private readonly env: Env) {}

  async send(phone: string, code: string): Promise<void> {
    // AT wants E.164 with a leading '+' (e.g. +23480…), not local 080…
    const to = `+${toNgE164(phone)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const body = new URLSearchParams({
        username: this.env.AT_USERNAME,
        to,
        message: `Your Rydafirst code is ${code}. It expires shortly. Do not share it with anyone.`,
      });
      // Only send a sender ID if one is configured; AT rejects an unregistered alphanumeric ID.
      if (this.env.AT_SMS_SENDER_ID) body.set('from', this.env.AT_SMS_SENDER_ID);

      const res = await fetch(`${this.env.AT_SMS_BASE_URL}/version1/messaging`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          apiKey: this.env.AT_API_KEY,
        },
        signal: controller.signal,
        body: body.toString(),
      });
      if (!res.ok) {
        this.log.error(`Africa's Talking send failed: HTTP ${res.status}`);
        throw new ServiceUnavailableException('Could not send verification code, please try again');
      }
      // AT returns 201 even when a recipient is rejected (e.g. bad number, insufficient balance):
      // the real per-recipient outcome is in statusCode. 100 Processed, 101 Sent, 102 Queued are OK.
      const data = (await res.json()) as {
        SMSMessageData?: { Recipients?: Array<{ statusCode?: number; status?: string }> };
      };
      const recipient = data?.SMSMessageData?.Recipients?.[0];
      const okCodes = new Set([100, 101, 102]);
      if (!recipient || !okCodes.has(Number(recipient.statusCode))) {
        this.log.error(`Africa's Talking rejected recipient: status=${recipient?.status ?? 'none'}`);
        throw new ServiceUnavailableException('Could not send verification code, please try again');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.error(`Africa's Talking send error: ${(err as Error).name}`);
      throw new ServiceUnavailableException('Could not send verification code, please try again');
    } finally {
      clearTimeout(timeout);
    }
  }
}
