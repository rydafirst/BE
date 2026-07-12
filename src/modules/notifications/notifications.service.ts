import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  chooseChannel, decideNotification, notificationKey, stageMessage, type JobStage,
} from './domain/notifications.js';
import {
  NOTIFICATION_OUTBOX, PUSH_SENDER, SMS_SENDER, NOTIFICATION_FEED, PUSH_TOKEN_STORE, PUSH_DISPATCHER,
  type NotificationOutbox, type PushSender, type SmsSender, type NotificationFeed, type NotificationItem,
  type PushTokenStore, type PushToken, type PushDispatcher, type PushMessage,
} from './ports.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_OUTBOX) private readonly outbox: NotificationOutbox,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(NOTIFICATION_FEED) private readonly feed: NotificationFeed,
    @Inject(PUSH_TOKEN_STORE) private readonly tokens: PushTokenStore,
    @Inject(PUSH_DISPATCHER) private readonly dispatcher: PushDispatcher,
  ) {}

  /**
   * Append an in-app notification to a user's bell feed AND send a push to their registered
   * devices. Both are best-effort — a push or feed failure can never break the job action that
   * triggered it. `urgent` events ring with a sound (like Uber); routine ones arrive silently.
   */
  async record(userId: string, n: { title: string; body: string; jobId?: string; urgent?: boolean }): Promise<void> {
    const item: NotificationItem = {
      id: randomUUID(), title: n.title, body: n.body, createdAt: Date.now(), read: false,
      ...(n.jobId ? { jobId: n.jobId } : {}),
    };
    try { await this.feed.append(userId, item); } catch { /* the feed is best-effort; never break a job action */ }
    try { await this.pushToDevices(userId, n); } catch { /* push is best-effort too */ }
  }

  private async pushToDevices(userId: string, n: { title: string; body: string; jobId?: string; urgent?: boolean }): Promise<void> {
    const devices = await this.tokens.listForUser(userId);
    if (devices.length === 0) return;
    await this.dispatcher.dispatch(devices.map((d) => ({
      to: d.token, title: n.title, body: n.body, urgent: Boolean(n.urgent),
      ...(n.jobId ? { jobId: n.jobId } : {}),
    })));
  }

  /**
   * Ring a set of riders about a newly-available job. Push-only (it never writes to the bell feed,
   * so the transient "new job" pings don't clutter a rider's notification history). Always urgent —
   * this is the Uber-style job alert. Fully best-effort.
   */
  async announceToRiders(riderIds: string[], n: { title: string; body: string; jobId?: string }): Promise<void> {
    try {
      const perRider = await Promise.all(riderIds.map((id) => this.tokens.listForUser(id)));
      const messages: PushMessage[] = [];
      for (const devices of perRider) {
        for (const d of devices) {
          messages.push({ to: d.token, title: n.title, body: n.body, urgent: true, ...(n.jobId ? { jobId: n.jobId } : {}) });
        }
      }
      if (messages.length > 0) await this.dispatcher.dispatch(messages);
    } catch { /* broadcast is best-effort — never break the job flow */ }
  }

  /** Register (or refresh) a device push token for a user. */
  registerToken(userId: string, token: PushToken): Promise<void> { return this.tokens.save(userId, token); }
  /** Remove a device token (e.g. on sign-out). */
  unregisterToken(userId: string, token: string): Promise<void> { return this.tokens.remove(userId, token); }

  list(userId: string, limit = 30): Promise<NotificationItem[]> { return this.feed.list(userId, limit); }
  markRead(userId: string): Promise<void> { return this.feed.markAllRead(userId); }
  unread(userId: string): Promise<number> { return this.feed.unreadCount(userId); }

  /** Notify a stage exactly once, preferring push and falling back to SMS. */
  async notifyStage(params: {
    jobId: string; stage: JobStage; userId: string; phone: string; pushAvailable: boolean;
  }): Promise<'sent' | 'skipped'> {
    const key = notificationKey(params.jobId, params.stage);
    if (decideNotification(await this.outbox.seen(key)) === 'skip') return 'skipped';

    const message = stageMessage(params.stage);
    let delivered = false;
    if (chooseChannel(params.pushAvailable) === 'push') {
      delivered = await this.push.send(params.userId, message);
    }
    if (!delivered) await this.sms.send(params.phone, message); // fallback

    await this.outbox.mark(key);
    return 'sent';
  }
}
