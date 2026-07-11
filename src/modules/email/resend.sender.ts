import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Env } from '../../config/env.validation.js';
import type { EmailMessage, EmailSender } from './email.port.js';

/**
 * Transactional email via Resend (https://resend.com). Fail-closed with a fast timeout so a
 * stuck provider can't hang a request. Never logs message bodies or the API key.
 */
export class ResendEmailSender implements EmailSender {
  private readonly log = new Logger('ResendEmailSender');

  constructor(private readonly env: Env) {}

  async send(msg: EmailMessage): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          from: this.env.EMAIL_FROM,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
        }),
      });
      if (!res.ok) {
        this.log.error(`Resend send failed: HTTP ${res.status}`);
        throw new ServiceUnavailableException('Could not send email, please try again');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.error(`Resend send error: ${(err as Error).name}`);
      throw new ServiceUnavailableException('Could not send email, please try again');
    } finally {
      clearTimeout(timeout);
    }
  }
}
