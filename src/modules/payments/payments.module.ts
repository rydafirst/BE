import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service.js';
import { PAYMENT_PROVIDER } from './payment-provider.interface.js';
import { BANK_DIRECTORY } from './bank-directory.port.js';
import { LEDGER_REPO, IDEMPOTENCY_STORE, WEBHOOK_INBOX } from './ports.js';
import { FlutterwaveProvider } from './adapters/flutterwave.provider.js';
import { FakePaymentProvider } from './adapters/fake.provider.js';
import {
  InMemoryLedgerRepo, InMemoryIdempotencyStore, InMemoryWebhookInbox,
} from './adapters/in-memory.adapters.js';
import { PrismaLedgerRepository } from './adapters/prisma-ledger.repo.js';
import { PrismaIdempotencyStore, PrismaWebhookInbox } from './adapters/prisma.stores.js';

const usePg = process.env.DB_DRIVER === 'postgres';
const useFlw = process.env.PAYMENT_DRIVER === 'flutterwave';

@Module({
  providers: [
    EscrowService,
    { provide: PAYMENT_PROVIDER, useClass: useFlw ? FlutterwaveProvider : FakePaymentProvider },
    // Bank directory is the same processor adapter, exposed through a narrow port for the account form.
    { provide: BANK_DIRECTORY, useExisting: PAYMENT_PROVIDER },
    { provide: LEDGER_REPO, useClass: usePg ? PrismaLedgerRepository : InMemoryLedgerRepo },
    { provide: IDEMPOTENCY_STORE, useClass: usePg ? PrismaIdempotencyStore : InMemoryIdempotencyStore },
    { provide: WEBHOOK_INBOX, useClass: usePg ? PrismaWebhookInbox : InMemoryWebhookInbox },
  ],
  exports: [EscrowService, BANK_DIRECTORY],
})
export class PaymentsModule {}
