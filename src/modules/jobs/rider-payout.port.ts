export interface RiderPayoutSource {
  /** Returns the rider's verified payout bank account, or null if none on file. */
  getPayout(riderId: string): Promise<{ bankCode: string; accountNumber: string } | null>;
}
export const RIDER_PAYOUT = Symbol('RIDER_PAYOUT');
