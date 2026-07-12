import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/security/encryption.service.js';
import { EscrowService } from '../payments/escrow.service.js';
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
  type?: AccountType;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNT_REPO) private readonly repo: AccountRepository,
    private readonly enc: EncryptionService,
    private readonly escrow: EscrowService,
  ) {}

  /** Name enquiry preview: validate the bank + number and return the real account holder name. */
  async resolve(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
    if (!isValidBankCode(bankCode)) throw new BadRequestException('Invalid bank code');
    if (!isValidAccountNumber(accountNumber)) throw new BadRequestException('Account number must be 10 digits');
    return this.escrow.resolveAccount(bankCode, accountNumber);
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
