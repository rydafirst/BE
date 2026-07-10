import { Injectable, Logger } from '@nestjs/common';
import type { NotificationOutbox, PushSender, SmsSender } from '../ports.js';

// DEV ONLY. Replace with Redis/Postgres outbox + FCM/APNs + SMS provider in the persistence phase.
@Injectable()
export class InMemoryOutbox implements NotificationOutbox {
  private set = new Set<string>();
  async seen(key: string): Promise<boolean> { return this.set.has(key); }
  async mark(key: string): Promise<void> { this.set.add(key); }
}

@Injectable()
export class DevPushSender implements PushSender {
  private log = new Logger('Push');
  async send(userId: string, message: string): Promise<boolean> {
    this.log.debug(`push -> ${userId}: ${message}`);
    return true;
  }
}

@Injectable()
export class DevSmsSender implements SmsSender {
  private log = new Logger('SMS');
  async send(phone: string, message: string): Promise<void> {
    this.log.debug(`sms -> ${phone}: ${message}`);
  }
}
