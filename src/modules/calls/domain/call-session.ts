/**
 * A masked call between the two parties of a job. Pure domain: types, one predicate, and the small
 * XML documents Africa's Talking expects back on its voice callback. No I/O, so it is fully unit
 * tested and the service that orchestrates it stays thin.
 */
export type CallSessionStatus =
  | 'PENDING'    // created, provider not yet called
  | 'RINGING'    // provider placed the call to the initiator; awaiting their answer
  | 'CONNECTED'  // initiator answered and we bridged to the counterparty
  | 'COMPLETED'  // call ended (final callback received)
  | 'FAILED'     // provider rejected the call, or the counterparty was unreachable
  | 'EXPIRED';   // the session went stale before it could bridge

export interface CallSession {
  id: string;
  jobId: string;
  initiatorUserId: string;
  counterpartyUserId: string;
  provider: string;
  providerRef?: string;   // provider session id, set once the call is placed
  status: CallSessionStatus;
  createdAt: number;      // epoch ms
  expiresAt: number;      // epoch ms — after this the session may no longer bridge
  durationSec?: number;
  costAmount?: string;
  costCurrency?: string;
}

/** How long a placed call may sit un-answered before it is treated as stale. */
export const CALL_SESSION_TTL_MS = 5 * 60 * 1000;
/** Hard cap on a bridged conversation, handed to the provider as maxDuration. */
export const CALL_MAX_SECONDS = 600;

/** A session may be bridged only while it is the freshly-placed, unexpired call we are waiting on. */
export function isBridgeable(session: Pick<CallSession, 'status' | 'expiresAt'>, nowMs: number): boolean {
  return session.status === 'RINGING' && session.expiresAt > nowMs;
}

/** Escape the few attribute values we interpolate into callback XML (numbers, messages). */
export function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Bridge the answered caller to `toNumber`, masking both behind `callerId` (our AT number). */
export function buildDialXml(toNumber: string, callerId: string, maxDurationSec: number): string {
  const dur = Math.max(1, Math.floor(maxDurationSec));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial phoneNumbers="${xmlEscape(toNumber)}" callerId="${xmlEscape(callerId)}" maxDuration="${dur}" record="false"/></Response>`
  );
}

/** Politely end a call we cannot (or will not) bridge. */
export function buildRejectXml(message: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>${xmlEscape(message)}</Say><Reject/></Response>`
  );
}

/** Acknowledgement body for the provider's final (isActive=0) callback — nothing left to do. */
export function buildEmptyXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
