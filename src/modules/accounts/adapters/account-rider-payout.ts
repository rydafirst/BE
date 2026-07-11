import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { RiderPayoutSource } from '../../jobs/rider-payout.port.js';
import { AccountsService } from '../accounts.service.js';

/**
 * Rider payout source backed by the rider's saved (encrypted) bank account.
 * Production: no verified account => no payout (fail-closed; escrow keeps holding the funds).
 * Non-production: falls back to a Flutterwave test account so payouts succeed in test mode.
 */
@Injectable()
export class AccountRiderPayout implements RiderPayoutSource {
  constructor(
    private readonly accounts: AccountsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async getPayout(riderId: string): Promise<{ bankCode: string; accountNumber: string } | null> {
    const saved = await this.accounts.getDecrypted(riderId);
    if (saved) return saved;
    if (this.env.NODE_ENV !== 'production') return { bankCode: '044', accountNumber: '0690000032' };
    return null;
  }
}
