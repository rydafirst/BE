import { Injectable } from '@nestjs/common';
import type { AccountRepository, StoredAccount } from '../ports.js';

// DEV ONLY. Replace with Prisma in the persistence phase. One account per user.
@Injectable()
export class InMemoryAccountRepo implements AccountRepository {
  private m = new Map<string, StoredAccount>();
  async get(userId: string): Promise<StoredAccount | null> { return this.m.get(userId) ?? null; }
  async upsert(userId: string, acct: StoredAccount): Promise<void> { this.m.set(userId, { ...acct }); }
}
