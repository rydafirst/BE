/** Result of asking the provider to place the first (caller) leg of a masked call. */
export interface PlaceCallResult {
  /** Provider's session id for the placed call, or null if it was rejected outright. */
  sessionId: string | null;
  /** Provider status string (e.g. 'Queued', 'InsufficientCredit'), kept for logs/diagnosis. */
  status: string;
}

/**
 * Places outbound voice calls through a masking provider (Africa's Talking today).
 *
 * A port, not a direct HTTP call, so the telephony vendor is swappable at the composition root
 * (Twilio/Sinch later) with no change to the call service, and so tests run against a fake.
 * `enabled()` lets the app fall back to direct dialing when no provider is configured.
 */
export interface CallProvider {
  /** True when the provider is fully configured (credentials + caller-ID number). */
  enabled(): boolean;
  /** The caller-ID number both parties see (our AT number); null when disabled. */
  callerId(): string | null;
  /** Ring `to` from the platform number; on answer the provider hits our voice callback. */
  placeCall(params: { to: string; clientRequestId: string }): Promise<PlaceCallResult>;
}

export const CALL_PROVIDER = Symbol('CALL_PROVIDER');
