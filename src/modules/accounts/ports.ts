import type { AccountType } from './domain/bank-account.js';

/** Persisted bank account. The account number is stored ENCRYPTED (never plaintext). */
export interface StoredAccount {
  bankCode: string;
  accountNumberEnc: string; // AES-256-GCM ciphertext
  accountName: string;
  type: AccountType;
}

export interface AccountRepository {
  get(userId: string): Promise<StoredAccount | null>;
  upsert(userId: string, acct: StoredAccount): Promise<void>;
}

export const ACCOUNT_REPO = Symbol('ACCOUNT_REPO');
