/**
 * Errand ("buy-for-me") money split — pure + testable.
 *
 * A customer pays: the GOODS amount they typed (plus any in-app top-ups) + the delivery fee. On
 * completion that escrow is split three ways:
 *   - VENDOR  ← the goods-money (never the rider),
 *   - RIDER   ← the delivery fee minus the platform's cut,
 *   - PLATFORM← its fee.
 * The invariant `vendor + rider + platform === collected` is what guarantees no money is created or
 * lost when an errand settles. The actual disbursement uses EscrowService.settleVendorPayout (vendor)
 * and the normal rider release (delivery fee) — this module only decides the amounts.
 */
export interface ErrandSplit {
  vendorMinor: number;   // goods-money, paid to the vendor's business account
  riderMinor: number;    // delivery fee earned by the rider (net of platform cut)
  platformMinor: number; // platform revenue
}

/** The vendor's verified business account captured at the store (name resolved via name-enquiry). */
export interface ErrandVendorAccount { bankCode: string; accountNumber: string; accountName: string }

/**
 * Errand ("buy-for-me") details carried on a Job of type ERRAND. `goodsMinor` is the amount the
 * customer typed (raised by any in-app top-ups); it is held in escrow and paid to the VENDOR — never
 * the rider. The rider only ever earns the delivery fee.
 */
export interface ErrandDetails {
  goodsMinor: number;                    // current goods total = declared + any top-ups; paid to the vendor
  deliveryFeeMinor?: number;             // the fixed trip fee (rider earns this); set at creation so top-ups
                                         // grow only the goods, never the fee
  shoppingList: string;
  store?: { name?: string; area?: string; address?: string };
  vendorAccount?: ErrandVendorAccount;   // captured by the rider at the store
  vendorApproved?: boolean;              // the customer confirmed the resolved account before payout
  vendorPaidAt?: number;                 // epoch ms the vendor payout was released
  vendorPayoutRef?: string;              // provider ref once the vendor transfer succeeds
  // In-app top-up (the shop price was higher than the customer typed):
  requestedTopUpMinor?: number;          // extra the rider is asking the customer to add
  topUpTxRef?: string;                   // the pending top-up collection's ref
  topUpTxId?: string;                    // set once the top-up is funded (idempotency marker)
  // Marketplace order (registered vendor, known price): the vendor account is pre-set + pre-approved,
  // so no rider capture / customer approval step — the vendor is paid automatically on delivery.
  autoVendorPayout?: boolean;
  marketplaceVendorId?: string;
}

export function splitErrand(p: { goodsMinor: number; deliveryTotalMinor: number; platformFeeMinor: number }): ErrandSplit {
  const { goodsMinor, deliveryTotalMinor, platformFeeMinor } = p;
  if (!Number.isInteger(goodsMinor) || !Number.isInteger(deliveryTotalMinor) || !Number.isInteger(platformFeeMinor)) {
    throw new Error('errand amounts must be integer minor units');
  }
  if (goodsMinor < 0 || deliveryTotalMinor < 0 || platformFeeMinor < 0) throw new Error('errand amounts must be non-negative');
  if (platformFeeMinor > deliveryTotalMinor) throw new Error('platform fee cannot exceed the delivery fee');
  return {
    vendorMinor: goodsMinor,
    riderMinor: deliveryTotalMinor - platformFeeMinor,
    platformMinor: platformFeeMinor,
  };
}

/** Total the customer must have funded for this split (goods + full delivery fee). */
export function errandCollectedMinor(s: ErrandSplit): number {
  return s.vendorMinor + s.riderMinor + s.platformMinor;
}
