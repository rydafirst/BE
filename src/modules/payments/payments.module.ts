import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service.js';
import { PAYMENT_PROVIDER } from './payment-provider.interface.js';
import { BANK_DIRECTORY } from './bank-directory.port.js';
import { LEDGER_REPO, IDEMPOTENCY_STORE, WEBHOOK_INBOX } from './ports.js';
import { DeferredPayoutDispatcher, InlinePayoutDispatcher, PAYOUT_DISPATCHER } from './payout-dispatcher.port.js';
import { FlutterwaveProvider } from './adapters/flutterwave.provider.js';
import { FakePaymentProvider } from './adapters/fake.provider.js';
import {
  InMemoryLedgerRepo, InMemoryIdempotencyStore, InMemoryWebhookInbox,
} from './adapters/in-memory.adapters.js';
import { PrismaLedgerRepository } from './adapters/prisma-ledger.repo.js';
import { PrismaIdempotencyStore, PrismaWebhookInbox } from './adapters/prisma.stores.js';

const usePg = process.env.DB_DRIVER === 'postgres';
const useFlw = process.env.PAYMENT_DRIVER === 'flutterwave';
/**
 * Deferred by default: the external bank transfer must not sit on the delivery-confirmation request
 * path, where a slow PSP turns into a failed code entry on the rider's phone. Set
 * PAYOUT_DISPATCH=inline to fall back to the original synchronous behaviour without a code change —
 * the ledger release and the retry queue are identical either way.
 */
const deferPayouts = process.env.PAYOUT_DISPATCH !== 'inline';

@Module({
  providers: [
    EscrowService,
    { provide: PAYMENT_PROVIDER, useClass: useFlw ? FlutterwaveProvider : FakePaymentProvider },
    // Bank directory is the same processor adapter, exposed through a narrow port for the account form.
    { provide: BANK_DIRECTORY, useExisting: PAYMENT_PROVIDER },
    { provide: LEDGER_REPO, useClass: usePg ? PrismaLedgerRepository : InMemoryLedgerRepo },
    { provide: IDEMPOTENCY_STORE, useClass: usePg ? PrismaIdempotencyStore : InMemoryIdempotencyStore },
    { provide: WEBHOOK_INBOX, useClass: usePg ? PrismaWebhookInbox : InMemoryWebhookInbox },
    { provide: PAYOUT_DISPATCHER, useClass: deferPayouts ? DeferredPayoutDispatcher : InlinePayoutDispatcher },
  ],
  exports: [EscrowService, BANK_DIRECTORY],
})
export class PaymentsModule {}
