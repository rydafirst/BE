import { Injectable } from '@nestjs/common';
import type { RiderPayoutSource } from '../rider-payout.port.js';

// DEV ONLY. Returns a Flutterwave test bank account so payouts succeed in test mode.
// Production: read the rider's verified PaymentAccount (type=payout) and decrypt the number.
@Injectable()
export class DevRiderPayout implements RiderPayoutSource {
  async getPayout(): Promise<{ bankCode: string; accountNumber: string }> {
    return { bankCode: '044', accountNumber: '0690000032' };
  }
}
