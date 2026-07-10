import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WalletService } from './wallet.service.js';
import { WalletController } from './wallet.controller.js';

@Module({
  imports: [JobsModule, PaymentsModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
