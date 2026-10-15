import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service.js';
import { AdminReferralsController, ReferralsController } from './referrals.controller.js';
import { REFERRAL_REPO } from './ports.js';
import { InMemoryReferralRepo } from './adapters/in-memory-referral.repo.js';
import { PrismaReferralRepo } from './adapters/prisma-referral.repo.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [AuthModule, JobsModule, SettingsModule, AccountsModule, PaymentsModule],
  controllers: [ReferralsController, AdminReferralsController],
  providers: [
    ReferralsService,
    { provide: REFERRAL_REPO, useClass: usePg ? PrismaReferralRepo : InMemoryReferralRepo },
  ],
  exports: [ReferralsService],
})
export class ReferralsModule {}
