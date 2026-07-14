/**
 * Security guard for verify-on-return funding. A caller supplies a transaction id; before we treat
 * a job as funded we must prove the transaction (a) belongs to THIS job's own checkout and (b) paid
 * at least the amount owed. Without this a cheap, unrelated, or reused payment could fund an
 * expensive order — the escrow hold would be short while the rider is later paid in full.
 * Pure + deterministic so it can be unit-tested in isolation.
 */
export type FundingDecision = { ok: true } | { ok: false; reason: 'mismatch' | 'underpaid' };

export function decideFunding(input: {
  jobFlwTxRef?: string;
  jobAmountMinor: number;
  verifiedTxRef: string;
  verifiedAmountMinor: number;
}): FundingDecision {
  // The verified transaction's reference must equal the reference we created for this job's checkout.
  if (!input.jobFlwTxRef || input.verifiedTxRef !== input.jobFlwTxRef) return { ok: false, reason: 'mismatch' };
  // Never fund on an underpayment: the hold must cover the fare we later release to the rider.
  if (input.verifiedAmountMinor < input.jobAmountMinor) return { ok: false, reason: 'underpaid' };
  return { ok: true };
}
