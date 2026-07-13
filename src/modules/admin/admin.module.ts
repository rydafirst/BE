import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidersModule } from '../riders/riders.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminOpsService } from './admin-ops.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [JobsModule, PaymentsModule, RidersModule, SettingsModule],
  controllers: [AdminController],
  providers: [AdminOpsService],
})
export class AdminModule {}
