import type { Bank } from './payment-provider.interface.js';

/**
 * The list of banks a user can pick from. Split out of PaymentProvider so consumers that only
 * need the bank directory (the account form) depend on this narrow capability, not the whole
 * payment interface. Backed by the same processor adapter at runtime.
 */
export interface BankDirectory {
  listBanks(): Promise<Bank[]>;
}

export const BANK_DIRECTORY = Symbol('BANK_DIRECTORY');
