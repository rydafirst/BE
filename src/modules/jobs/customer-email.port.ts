export interface CustomerEmailSource {
  /** The customer's email on file (for payment receipts / mail trail), or null if none. */
  getEmail(userId: string): Promise<string | null>;
}
export const CUSTOMER_EMAIL = Symbol('CUSTOMER_EMAIL');
