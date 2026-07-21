// Pure push-notification rules — no I/O, so they can be unit-tested in isolation.

/**
 * Accept only well-formed Expo push tokens. Anything else (a stray string, an APNs/FCM token,
 * an injection attempt) is rejected so it can never reach the push service — fail-closed.
 */
export function isValidExpoToken(token: string): boolean {
  return /^ExponentPushToken\[[^\]\s]+\]$/.test(token) || /^ExpoPushToken\[[^\]\s]+\]$/.test(token);
}

/** Urgent events (rider assigned, cancelled, failed) ring; routine updates arrive silently. */
export function pushSound(urgent: boolean): 'default' | null {
  return urgent ? 'default' : null;
}

/** Android delivery channel: the 'urgent' channel carries sound + max importance. */
export function pushChannel(urgent: boolean): 'urgent' | 'default' {
  return urgent ? 'urgent' : 'default';
}

/** Expo priority: urgent messages are delivered immediately. */
export function pushPriority(urgent: boolean): 'high' | 'default' {
  return urgent ? 'high' : 'default';
}

/** Outcome of one dispatch attempt, so callers can log failures and retire dead devices. */
export interface PushDeliveryReport {
  accepted: number;
  failed: ReadonlyArray<{ token: string; reason: string }>;
  /** Tokens Expo explicitly reported as belonging to an uninstalled/reset app. Safe to delete. */
  invalidTokens: readonly string[];
}

export const EMPTY_REPORT: PushDeliveryReport = { accepted: 0, failed: [], invalidTokens: [] };

/**
 * Interpret Expo's push response.
 *
 * This exists because Expo answers **200 OK even when individual messages fail** — the per-message
 * verdict is in the body, one ticket per message, positionally aligned with the batch that was sent.
 * Only checking `res.ok` therefore reports success while delivering nothing, which is precisely the
 * blind spot that left us with no evidence when riders said notifications never arrived.
 *
 * Fail-safe on anything unexpected: an unparseable or wrong-length body yields NO invalid tokens.
 * Pruning on a shape we do not understand would delete every device a user owns.
 */
export function readExpoTickets(tokens: readonly string[], body: unknown): PushDeliveryReport {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== tokens.length) return EMPTY_REPORT;

  let accepted = 0;
  const failed: Array<{ token: string; reason: string }> = [];
  const invalidTokens: string[] = [];

  data.forEach((ticket, i) => {
    const token = tokens[i];
    if (token === undefined) return;
    const t = (ticket ?? {}) as { status?: unknown; message?: unknown; details?: { error?: unknown } };
    if (t.status === 'ok') { accepted++; return; }
    const detail = typeof t.details?.error === 'string' ? t.details.error : undefined;
    const message = typeof t.message === 'string' ? t.message : undefined;
    failed.push({ token, reason: detail ?? message ?? 'unknown push error' });
    // The ONLY condition under which a token is retired: Expo states the app is gone from the
    // device. Transient faults (MessageRateExceeded, MessageTooBig) must keep the token.
    if (detail === 'DeviceNotRegistered') invalidTokens.push(token);
  });

  return { accepted, failed, invalidTokens };
}
