import type { CallSession, CallSessionStatus } from './domain/call-session.js';

/**
 * Persistence for masked-call sessions. Small on purpose: the service only needs to create a
 * session, tag it with the provider's id once placed, flip its status, look it up by provider id
 * when the callback lands, and record the final duration/cost.
 */
export interface CallSessionRepository {
  create(session: CallSession): Promise<void>;
  /** Attach the provider's session id and move to the given status (typically RINGING). */
  setProviderRef(id: string, providerRef: string, status: CallSessionStatus): Promise<void>;
  setStatus(id: string, status: CallSessionStatus): Promise<void>;
  findByProviderRef(providerRef: string): Promise<CallSession | null>;
  /** Record the final call outcome from the provider's closing callback. */
  complete(id: string, durationSec: number, cost?: { amount: string; currency: string }): Promise<void>;
}

export const CALL_SESSION_REPO = Symbol('CALL_SESSION_REPO');
