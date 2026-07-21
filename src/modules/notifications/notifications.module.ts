import { Logger, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATION_OUTBOX, PUSH_SENDER, SMS_SENDER, NOTIFICATION_FEED, PUSH_TOKEN_STORE, PUSH_DISPATCHER } from './ports.js';
import { InMemoryOutbox, DevPushSender, DevSmsSender } from './adapters/dev.adapters.js';
import { RedisOutbox } from './adapters/redis-outbox.js';
import { InMemoryNotificationFeed, RedisNotificationFeed } from './adapters/notification-feed.js';
import { InMemoryPushTokenStore, RedisPushTokenStore } from './adapters/push-token-store.js';
import { DevPushDispatcher, ExpoPushDispatcher } from './adapters/push-dispatcher.js';

const usePg = process.env.DB_DRIVER === 'postgres';
// Send real push notifications when explicitly enabled (prod); otherwise log them in dev.
const usePush = process.env.PUSH_DRIVER === 'expo';

// A production deployment running the dev logger delivers ZERO notifications, and does it silently:
// every send "succeeds". That is indistinguishable from broken push to everyone except whoever reads
// the boot logs — so say it loudly, once, at startup.
if (usePg && !usePush) {
  new Logger('NotificationsModule').error(
    'PUSH_DRIVER is not "expo" while running against Postgres — push notifications are being LOGGED, NOT SENT. ' +
    'Set PUSH_DRIVER=expo to deliver to devices.',
  );
}


@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_OUTBOX, useClass: usePg ? RedisOutbox : InMemoryOutbox },
    { provide: NOTIFICATION_FEED, useClass: usePg ? RedisNotificationFeed : InMemoryNotificationFeed },
    { provide: PUSH_TOKEN_STORE, useClass: usePg ? RedisPushTokenStore : InMemoryPushTokenStore },
    { provide: PUSH_DISPATCHER, useClass: usePush ? ExpoPushDispatcher : DevPushDispatcher },
    { provide: PUSH_SENDER, useClass: DevPushSender },
    { provide: SMS_SENDER, useClass: DevSmsSender },
  ],
  // The outbox is exported so the inactivity monitor can dedupe its reminders through the same
  // once-only mechanism every other notification uses, rather than inventing a second one.
  exports: [NotificationsService, NOTIFICATION_OUTBOX],
})
export class NotificationsModule {}
