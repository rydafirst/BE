import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/security/encryption.service.js';
import { isValidAccountNumber, isValidBankCode, maskAccountNumber, type AccountType } from './domain/bank-account.js';
import { ACCOUNT_REPO, type AccountRepository } from './ports.js';

export interface MaskedAccount {
  bankCode: string;
  accountName: string;
  accountNumberMasked: string;
  type: AccountType;
}

export interface SetAccountInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  type?: AccountType;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNT_REPO) private readonly repo: AccountRepository,
    private readonly enc: EncryptionService,
  ) {}

  /** Safe view for the client — the full number is never returned, only the last 4 digits. */
  async getMasked(userId: string): Promise<MaskedAccount | null> {
    const a = await this.repo.get(userId);
    if (!a) return null;
    const number = this.enc.decrypt(a.accountNumberEnc);
    return { bankCode: a.bankCode, accountName: a.accountName, accountNumberMasked: maskAccountNumber(number), type: a.type };
  }

  /** Validate, then store with the account number encrypted at rest. Returns the masked view. */
  async set(userId: string, input: SetAccountInput): Promise<MaskedAccount> {
    if (!isValidBankCode(input.bankCode)) throw new BadRequestException('Invalid bank code');
    if (!isValidAccountNumber(input.accountNumber)) throw new BadRequestException('Account number must be 10 digits');
    const name = input.accountName.trim();
    if (name.length < 2) throw new BadRequestException('Account name is required');

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
