import { Inject, Injectable } from '@nestjs/common';
import {
  chooseChannel, decideNotification, notificationKey, stageMessage, type JobStage,
} from './domain/notifications.js';
import {
  NOTIFICATION_OUTBOX, PUSH_SENDER, SMS_SENDER,
  type NotificationOutbox, type PushSender, type SmsSender,
} from './ports.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_OUTBOX) private readonly outbox: NotificationOutbox,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

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
