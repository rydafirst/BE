/**
 * A one-method view of a rider's account state, so consumers that only need to know
 * "does this rider have a payout account?" (jobs acceptance, going online) depend on this
 * narrow port instead of the full AccountsService. Implemented by AccountsService.
 */
export interface RiderAccountStatus {
  hasAccount(riderId: string): Promise<boolean>;
}

export const RIDER_ACCOUNT_STATUS = Symbol('RIDER_ACCOUNT_STATUS');
