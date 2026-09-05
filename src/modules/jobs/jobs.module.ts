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
import { DocumentsModule } from '../documents/documents.module.js';
import { RatingsModule } from '../ratings/ratings.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { PrismaJobRepository } from './adapters/prisma-job.repo.js';
import { RATE_LIMITER } from '../auth/ports.js';
import { InMemoryRateLimiter } from '../auth/adapters/in-memory.adapters.js';
import { RedisRateLimiter } from '../auth/adapters/redis-rate-limiter.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { VendorsModule } from '../vendors/vendors.module.js';
import { VendorsService } from '../vendors/vendors.service.js';
import { MARKETPLACE_VENDOR_SOURCE } from './marketplace.port.js';
import { JOB_STATUS_LOG } from './status-log.port.js';
import { InMemoryJobStatusLog, PrismaJobStatusLog } from './adapters/status-log.adapters.js';
import { InactivityMonitor } from './inactivity.monitor.js';
import { LatenessMonitor } from './lateness.monitor.js';
import { JobTimingsService } from './job-timings.service.js';
import { JobDiscoveryService } from './job-discovery.service.js';
import { JobRatingsService } from './job-ratings.service.js';
import { CallsController } from '../calls/calls.controller.js';
import { VoiceWebhookController } from '../calls/voice-webhook.controller.js';
import { CallSessionService } from '../calls/call-session.service.js';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { CALL_PROVIDER } from '../calls/call-provider.port.js';
import { AfricasTalkingCallProvider } from '../calls/adapters/africastalking-call.provider.js';
import { CALL_SESSION_REPO } from '../calls/call-session.repo.port.js';
import { InMemoryCallSessionRepo } from '../calls/adapters/in-memory-call-session.repo.js';
import { PrismaCallSessionRepo } from '../calls/adapters/prisma-call-session.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [PaymentsModule, AccountsModule, NotificationsModule, PresenceModule, DocumentsModule, RatingsModule, SettingsModule, AuthModule, ProfileModule, VendorsModule],
  controllers: [JobsController, WebhooksController, CallsController, VoiceWebhookController],
  providers: [
    JobsService,
    // #4 MULTI-STOP: peppered hashing for per-stop confirmation codes (JobsService dependency).
    HmacHasher,
    // Masked in-app calling (Africa's Talking). Registered here so it shares this module's single
    // JOB_REPO / RATE_LIMITER instance; USER_REPO comes from AuthModule.
    CallSessionService,
    { provide: CALL_PROVIDER, useClass: AfricasTalkingCallProvider },
    { provide: CALL_SESSION_REPO, useClass: usePg ? PrismaCallSessionRepo : InMemoryCallSessionRepo },
    { provide: JOB_REPO, useClass: usePg ? PrismaJobRepository : InMemoryJobRepo },
    // Reuse the same rate limiter (Redis in prod) to cap rider job-releases per day.
    { provide: RATE_LIMITER, useClass: usePg ? RedisRateLimiter : InMemoryRateLimiter },
    // Rider payout now reads the rider's own saved (encrypted) bank account.
    { provide: RIDER_PAYOUT, useExisting: AccountRiderPayout },
    // Append-only status history: powers per-stage timings and the inactivity scan.
    { provide: JOB_STATUS_LOG, useClass: usePg ? PrismaJobStatusLog : InMemoryJobStatusLog },
    InactivityMonitor,
    LatenessMonitor,
    JobTimingsService,
    JobDiscoveryService,
    JobRatingsService,
    // Marketplace checkout reads the vendor catalog through this port (bound to VendorsService).
    { provide: MARKETPLACE_VENDOR_SOURCE, useExisting: VendorsService },
  ],
  exports: [JobsService],
})
export class JobsModule {}
