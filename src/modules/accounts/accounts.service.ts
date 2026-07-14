import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/security/encryption.service.js';
import { EscrowService } from '../payments/escrow.service.js';
import type { Bank } from '../payments/payment-provider.interface.js';
import { BANK_DIRECTORY, type BankDirectory } from '../payments/bank-directory.port.js';
import { isValidAccountNumber, isValidBankCode, maskAccountNumber, type AccountType } from './domain/bank-account.js';
import { ACCOUNT_REPO, type AccountRepository } from './ports.js';
import type { RiderAccountStatus } from './rider-account-status.port.js';

export interface MaskedAccount {
  bankCode: string;
  accountName: string;
  accountNumberMasked: string;
  type: AccountType;
}

export interface SetAccountInput {
  bankCode: string;
  accountNumber: string;
  type?: AccountType;
}

@Injectable()
export class AccountsService implements RiderAccountStatus {
  constructor(
    @Inject(ACCOUNT_REPO) private readonly repo: AccountRepository,
    private readonly enc: EncryptionService,
    private readonly escrow: EscrowService,
    @Inject(BANK_DIRECTORY) private readonly bankDirectory: BankDirectory,
  ) {}

  // The bank list rarely changes, so cache it briefly to avoid hitting the processor on every open.
  private banksCache: { at: number; banks: Bank[] } | null = null;
  private static readonly BANKS_TTL_MS = 6 * 60 * 60 * 1000;

  /** Banks for the account picker — the user chooses a name, we keep the matching code. */
  async listBanks(): Promise<Bank[]> {
    const now = Date.now();
    if (this.banksCache && now - this.banksCache.at < AccountsService.BANKS_TTL_MS) return this.banksCache.banks;
    const banks = await this.bankDirectory.listBanks();
    this.banksCache = { at: now, banks };
    return banks;
  }

  /** Name enquiry preview: validate the bank + number and return the real account holder name. */
  async resolve(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
    if (!isValidBankCode(bankCode)) throw new BadRequestException('Invalid bank code');
    if (!isValidAccountNumber(accountNumber)) throw new BadRequestException('Account number must be 10 digits');
    return this.escrow.resolveAccount(bankCode, accountNumber);
  }

  /** True only if this user has actually saved their own bank account (no dev fallback). */
  async hasAccount(userId: string): Promise<boolean> {
    return (await this.repo.get(userId)) !== null;
  }

  /** Safe view for the client — the full number is never returned, only the last 4 digits. */
  async getMasked(userId: string): Promise<MaskedAccount | null> {
    const a = await this.repo.get(userId);
    if (!a) return null;
    const number = this.enc.decrypt(a.accountNumberEnc);
    return { bankCode: a.bankCode, accountName: a.accountName, accountNumberMasked: maskAccountNumber(number), type: a.type };
  }

  /**
   * Validate the bank + number, resolve the real account holder name via the bank (name enquiry),
   * then store with the number encrypted at rest. The client never supplies the name, so a stored
   * account always shows the true holder — and resolution doubles as proof the account exists.
   */
  async set(userId: string, input: SetAccountInput): Promise<MaskedAccount> {
    if (!isValidBankCode(input.bankCode)) throw new BadRequestException('Invalid bank code');
    if (!isValidAccountNumber(input.accountNumber)) throw new BadRequestException('Account number must be 10 digits');

    const { accountName } = await this.escrow.resolveAccount(input.bankCode, input.accountNumber);
    const name = accountName.trim();
    if (name.length < 2) throw new BadRequestException('Could not verify that account');

    await this.repo.upsert(userId, {
      bankCode: input.bankCode,
      accountNumberEnc: this.enc.encrypt(input.accountNumber),
      accountName: name,
      type: input.type ?? 'payout',
    });
    return (await this.getMasked(userId))!;
  }

  /** INTERNAL ONLY: decrypt the full account for a payout transfer. Never exposed via HTTP. */
  async getDecrypted(userId: string): Promise<{ bankCode: string; accountNumber: string } | null> {
    const a = await this.repo.get(userId);
    if (!a) return null;
    return { bankCode: a.bankCode, accountNumber: this.enc.decrypt(a.accountNumberEnc) };
  }
}
