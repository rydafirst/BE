/**
 * App Store / Play Store reviewer logins.
 *
 * Reviewers must be able to sign in to test the app, but Rydafirst authenticates with a one-time
 * code delivered out-of-band (email/SMS) — a reviewer can't receive that. This gives a small set of
 * configured demo identities a fixed code each, so a reviewer can log in. Typically you configure
 * one for the customer flow and one for the rider flow.
 *
 * Safety properties:
 *  - Fail-closed: an identity exists only when BOTH a phone and a code are configured for it.
 *  - Scoped: only the exact configured phones are affected. They are ordinary accounts — grant no
 *    elevated privileges here (keep these numbers OUT of ADMIN_PHONES).
 *  - Constant-time comparison of the code, so this path leaks no timing signal.
 */
export interface ReviewIdentity { phone: string; otp: string }
export type ReviewLoginConfig = readonly ReviewIdentity[];

/** A configured code must be 4–8 digits (same rule the env schema enforces). */
const CODE_RE = /^\d{4,8}$/;

/**
 * Parse reviewer identities from config.
 * `raw` is a comma-separated list of `phone:code` pairs, e.g. "+2348011111111:246810,+234802...:135791".
 * `legacyPhone`/`legacyOtp` keep the original single-identity vars working. Malformed or incomplete
 * entries are dropped (fail-closed) — the env schema validates the format at boot so typos surface.
 */
export function parseReviewLogins(raw: string, legacyPhone = '', legacyOtp = ''): ReviewLoginConfig {
  const out: ReviewIdentity[] = [];
  const add = (phone: string, otp: string) => {
    const p = phone.trim();
    const c = otp.trim();
    if (!p || !CODE_RE.test(c)) return;              // fail-closed on incomplete/invalid
    if (out.some((i) => i.phone === p)) return;      // first definition wins
    out.push({ phone: p, otp: c });
  };
  for (const entry of raw.split(',')) {
    if (!entry.trim()) continue;
    const idx = entry.lastIndexOf(':');              // lastIndexOf so "+234..." is safe
    if (idx === -1) continue;
    add(entry.slice(0, idx), entry.slice(idx + 1));
  }
  add(legacyPhone, legacyOtp);
  return out;
}

/** Only active when at least one reviewer identity is configured. */
export function reviewLoginEnabled(cfg: ReviewLoginConfig): boolean {
  return cfg.length > 0;
}

/** True when this phone is one of the configured reviewer identities. */
export function isReviewPhone(cfg: ReviewLoginConfig, phone: string): boolean {
  return cfg.some((i) => i.phone === phone);
}

/** Constant-time check that the presented code matches that reviewer's configured code. */
export function reviewCodeMatches(cfg: ReviewLoginConfig, phone: string, code: string): boolean {
  const identity = cfg.find((i) => i.phone === phone);
  if (!identity) return false;
  return constantTimeEquals(code, identity.otp);
}

/** Length-checked constant-time string comparison (OTP length is not secret). */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
