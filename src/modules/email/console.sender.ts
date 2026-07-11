import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from './email.port.js';

/** DEV fallback used when RESEND_API_KEY is not set — logs the email instead of sending it. */
export class ConsoleEmailSender implements EmailSender {
  private readonly log = new Logger('EmailSender');
  async send(msg: EmailMessage): Promise<void> {
    this.log.debug(`Email to ${msg.to} — "${msg.subject}"`);
  }
}
