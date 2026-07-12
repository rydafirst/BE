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
