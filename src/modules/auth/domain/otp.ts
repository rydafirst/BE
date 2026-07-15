import { randomInt } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;

/** Cryptographically-random numeric OTP. */
export function generateOtp(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) code += randomInt(0, 10).toString();
  return code;
}

export interface OtpRecord {
  codeHash: string;      // HMAC of the code (never plaintext)
  createdAtMs: number;
  attempts: number;
  consumed: boolean;
  email?: string;        // captured at request time so it can be saved to the account on verify
  name?: string;         // captured at sign-up so it can be saved to the account on verify
}

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'too_many_attempts' | 'already_used' | 'mismatch' };

/**
 * Pure verification decision. Does not reveal whether a record exists (no enumeration):
 * callers return the SAME generic response regardless of reason.
 */
export function checkOtp(
  record: OtpRecord,
  matches: boolean,
  nowMs: number,
): OtpCheck {
  if (record.consumed) return { ok: false, reason: 'already_used' };
  if (record.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (nowMs - record.createdAtMs > OTP_TTL_SECONDS * 1000) return { ok: false, reason: 'expired' };
  if (!matches) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
