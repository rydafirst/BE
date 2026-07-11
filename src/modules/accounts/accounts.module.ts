import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { EncryptionService } from '../../common/security/encryption.service.js';
import { ACCOUNT_REPO } from './ports.js';
import { InMemoryAccountRepo } from './adapters/in-memory-account.repo.js';
import { PrismaAccountRepo } from './adapters/prisma-account.repo.js';
import { AccountRiderPayout } from './adapters/account-rider-payout.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    EncryptionService, // stateless; ENV is global via ConfigModule
    AccountRiderPayout,
    { provide: ACCOUNT_REPO, useClass: usePg ? PrismaAccountRepo : InMemoryAccountRepo },
  ],
  exports: [AccountsService, AccountRiderPayout],
})
export class AccountsModule {}
