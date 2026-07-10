import type { SettlementOutcome } from '../../payments/domain/refund.js';

export type DisputeStatus = 'OPEN' | 'AWAITING_EVIDENCE' | 'UNDER_REVIEW' | 'RESOLVED';

const TRANSITIONS: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = {
  OPEN: ['AWAITING_EVIDENCE', 'UNDER_REVIEW', 'RESOLVED'],
  AWAITING_EVIDENCE: ['UNDER_REVIEW', 'RESOLVED'],
  UNDER_REVIEW: ['RESOLVED'],
  RESOLVED: [],
};

export function canDisputeTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h to open after completion

export function canOpenDispute(referenceMs: number, nowMs: number, windowMs = DISPUTE_WINDOW_MS): boolean {
  return nowMs - referenceMs <= windowMs;
}

/** Objective signals the system auto-collects for a job. */
export interface EvidenceSignals {
  reachedGeofence: boolean;   // did the rider actually get to the drop?
  validCodeEntered: boolean;  // was a valid receiver code entered?
  counterEvidence: boolean;   // did a party submit conflicting evidence?
}

export type AutoDecision =
  | { tier: 'auto'; resolution: 'RELEASE' | 'REFUND' }
  | { tier: 'manual' };

/**
 * Tiered resolution: clear-cut cases resolve automatically; anything ambiguous
 * (or with counter-evidence) escalates to a human. Never guesses.
 */
export function autoResolve(signals: EvidenceSignals): AutoDecision {
  if (signals.counterEvidence) return { tier: 'manual' };
  if (!signals.reachedGeofence) return { tier: 'auto', resolution: 'REFUND' };
  if (signals.reachedGeofence && signals.validCodeEntered) return { tier: 'auto', resolution: 'RELEASE' };
  return { tier: 'manual' };
}

export type Resolution = 'RELEASE' | 'REFUND' | 'SPLIT';

export function resolutionToSettlement(resolution: Resolution): SettlementOutcome {
  switch (resolution) {
    case 'RELEASE': return 'RELEASE_FULL';
    case 'REFUND': return 'REFUND_FULL';
    case 'SPLIT': return 'DISPUTE_SPLIT';
    default: {
      const _never: never = resolution;
      throw new Error(`Unknown resolution: ${String(_never)}`);
    }
  }
}
