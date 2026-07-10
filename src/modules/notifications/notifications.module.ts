import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NOTIFICATION_OUTBOX, PUSH_SENDER, SMS_SENDER } from './ports.js';
import { InMemoryOutbox, DevPushSender, DevSmsSender } from './adapters/dev.adapters.js';
import { RedisOutbox } from './adapters/redis-outbox.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Module({
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_OUTBOX, useClass: usePg ? RedisOutbox : InMemoryOutbox },
    { provide: PUSH_SENDER, useClass: DevPushSender },
    { provide: SMS_SENDER, useClass: DevSmsSender },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
