import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { EncryptionService } from '../../common/security/encryption.service.js';
import { ACCOUNT_REPO } from './ports.js';
import { InMemoryAccountRepo } from './adapters/in-memory-account.repo.js';
import { PrismaAccountRepo } from './adapters/prisma-account.repo.js';
import { AccountRiderPayout } from './adapters/account-rider-payout.js';
import { RIDER_ACCOUNT_STATUS } from './rider-account-status.port.js';
import { PaymentsModule } from '../payments/payments.module.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [PaymentsModule], // for name-enquiry (EscrowService.resolveAccount) + bank directory
  controllers: [AccountsController],
  providers: [
    AccountsService,
    EncryptionService, // stateless; ENV is global via ConfigModule
    AccountRiderPayout,
    // Narrow "does this rider have a payout account?" port for jobs/presence gates.
    { provide: RIDER_ACCOUNT_STATUS, useExisting: AccountsService },
    { provide: ACCOUNT_REPO, useClass: usePg ? PrismaAccountRepo : InMemoryAccountRepo },
  ],
  exports: [AccountsService, AccountRiderPayout, RIDER_ACCOUNT_STATUS],
})
export class AccountsModule {}
