import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './database/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ConfirmationsModule } from './modules/confirmations/confirmations.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { DisputesModule } from './modules/disputes/disputes.module.js';
import { RidersModule } from './modules/riders/riders.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { EncryptionService } from './common/security/encryption.service.js';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard.js';
import { RolesGuard } from './common/auth/roles.guard.js';

// Postgres/Redis are only wired when DB_DRIVER=postgres; memory mode boots with no external services.
const dataModules = process.env.DB_DRIVER === 'postgres' ? [DatabaseModule, RedisModule] : [];

@Module({
  imports: [ConfigModule, ...dataModules, EmailModule, HealthModule, AuthModule, IdentityModule, PaymentsModule, JobsModule, ConfirmationsModule, TrackingModule, NotificationsModule, DisputesModule, RidersModule, AdminModule, WalletModule, AccountsModule],
  providers: [
    EncryptionService,
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [EncryptionService],
})
export class AppModule {}
