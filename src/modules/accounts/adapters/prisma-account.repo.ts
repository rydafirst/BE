import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { AccountRepository, StoredAccount } from '../ports.js';

// One saved account per user. accountNumber column holds AES-256-GCM ciphertext (never plaintext).
@Injectable()
export class PrismaAccountRepo implements AccountRepository {
  constructor(private readonly db: PrismaService) {}

  async get(userId: string): Promise<StoredAccount | null> {
    const r = await this.db.paymentAccount.findFirst({ where: { userId } });
    if (!r) return null;
    return { bankCode: r.bankCode, accountNumberEnc: r.accountNumber, accountName: r.accountName, type: r.type as StoredAccount['type'] };
  }

  async upsert(userId: string, acct: StoredAccount): Promise<void> {
    const existing = await this.db.paymentAccount.findFirst({ where: { userId } });
    const data = { userId, bankCode: acct.bankCode, accountNumber: acct.accountNumberEnc, accountName: acct.accountName, type: acct.type, verified: false };
    if (existing) await this.db.paymentAccount.update({ where: { id: existing.id }, data });
    else await this.db.paymentAccount.create({ data });
  }
}
