/**
 * App Store reviewer login.
 *
 * Apple's App Review must be able to sign in to test the app, but Rydafirst authenticates with a
 * one-time code delivered out-of-band (email/SMS) — a reviewer can't receive that. This gives a
 * single, configured demo identity a fixed code so the reviewer can log in.
 *
 * Safety properties:
 *  - Fail-closed: disabled entirely unless BOTH a phone and a code are configured.
 *  - Scoped: only the exact configured phone is affected; it is an ordinary account with no
 *    elevated privileges.
 *  - Constant-time comparison of the code, so this path leaks no timing signal.
 */
export interface ReviewLoginConfig {
  phone: string;
  otp: string;
}

/** Only active when both a phone and a code are configured. */
export function reviewLoginEnabled(cfg: ReviewLoginConfig): boolean {
  return cfg.phone.length > 0 && cfg.otp.length > 0;
}

/** True when this phone is the configured reviewer identity (and the feature is enabled). */
export function isReviewPhone(cfg: ReviewLoginConfig, phone: string): boolean {
  return reviewLoginEnabled(cfg) && phone === cfg.phone;
}

/** Constant-time check that the presented code matches the configured reviewer code. */
export function reviewCodeMatches(cfg: ReviewLoginConfig, phone: string, code: string): boolean {
  if (!isReviewPhone(cfg, phone)) return false;
  return constantTimeEquals(code, cfg.otp);
}

/** Length-checked constant-time string comparison (OTP length is not secret). */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
