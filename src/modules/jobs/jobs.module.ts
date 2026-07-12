import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { JOB_REPO } from './ports.js';
import { InMemoryJobRepo } from './adapters/in-memory-job.repo.js';
import { RIDER_PAYOUT } from './rider-payout.port.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AccountRiderPayout } from '../accounts/adapters/account-rider-payout.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { PrismaJobRepository } from './adapters/prisma-job.repo.js';
import { RATE_LIMITER } from '../auth/ports.js';
import { InMemoryRateLimiter } from '../auth/adapters/in-memory.adapters.js';
import { RedisRateLimiter } from '../auth/adapters/redis-rate-limiter.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [PaymentsModule, AccountsModule, NotificationsModule, PresenceModule],
  controllers: [JobsController, WebhooksController],
  providers: [
    JobsService,
    { provide: JOB_REPO, useClass: usePg ? PrismaJobRepository : InMemoryJobRepo },
    // Reuse the same rate limiter (Redis in prod) to cap rider job-releases per day.
    { provide: RATE_LIMITER, useClass: usePg ? RedisRateLimiter : InMemoryRateLimiter },
    // Rider payout now reads the rider's own saved (encrypted) bank account.
    { provide: RIDER_PAYOUT, useExisting: AccountRiderPayout },
  ],
  exports: [JobsService],
})
export class JobsModule {}
