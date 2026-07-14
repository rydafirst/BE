import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Money } from '../domain/money.js';
import type { LedgerEntry } from '../domain/ledger.js';
import type { LedgerRepository } from '../ports.js';
import type { EscrowTotals } from '../domain/reconciliation.js';

@Injectable()
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly db: PrismaService) {}

  /** Append a balanced set of entries in ONE transaction (all-or-nothing). Never updates rows. */
  async append(entries: readonly LedgerEntry[]): Promise<void> {
    await this.db.ledgerEntry.createMany({
      data: entries.map((e) => ({
        jobId: e.jobId,
        account: e.account,
        direction: e.direction,
        amount: e.amount.amount,
      })),
    });
  }

  async sumCreditForJobs(account: string, jobIds: readonly string[]): Promise<number> {
    if (jobIds.length === 0) return 0;
    const r = await this.db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { account: account as never, direction: 'CREDIT', jobId: { in: [...jobIds] } },
    });
    return r._sum.amount ?? 0;
  }
  async sumCredit(account: string): Promise<number> {
    const r = await this.db.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { account: account as never, direction: 'CREDIT' },
    });
    return r._sum.amount ?? 0;
  }

  /** Derived totals (credits) straight from the append-only rows. */
  async totals(): Promise<EscrowTotals> {
    // NOTE: Prisma's groupBy typings require an explicit `orderBy` for overload resolution;
    // omitting it triggers a spurious "missing array properties" compile error. The cast keeps
    // the result shape stable for our aggregation below.
    const grouped = (await this.db.ledgerEntry.groupBy({
      by: ['account', 'direction'],
      _sum: { amount: true },
      orderBy: [{ account: 'asc' }, { direction: 'asc' }],
    })) as unknown as Array<{ account: string; direction: string; _sum: { amount: number | null } }>;
    const net = (account: string): number => {
      const credit = grouped.find((g) => g.account === account && g.direction === 'CREDIT')?._sum.amount ?? 0;
      const debit = grouped.find((g) => g.account === account && g.direction === 'DEBIT')?._sum.amount ?? 0;
      return Math.max(0, credit - debit);
    };
    return {
      held: Money.of(net('ESCROW')),
      released: Money.of(net('RIDER_PAYABLE')),
      refunded: Money.of(net('CUSTOMER_REFUND')),
    };
  }
}
