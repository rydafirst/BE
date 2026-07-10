import { randomInt } from 'node:crypto';

export type CodeKind = 'DELIVERY' | 'START_PIN' | 'PROXY';
export const CODE_LENGTH = 4;
export const CODE_TTL_SECONDS = 3600;
export const CODE_MAX_ATTEMPTS = 5;

/** Random numeric code. Delivered to the receiver in-app; NEVER a bank OTP (anti-scam). */
export function generateCode(): string {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += randomInt(0, 10).toString();
  return c;
}

export interface CodeRecord {
  kind: CodeKind;
  codeHash: string;   // HMAC, never plaintext
  createdAtMs: number;
  attempts: number;
  consumed: boolean;
}

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'too_many_attempts' | 'already_used' | 'mismatch' };

export function checkCode(record: CodeRecord, matches: boolean, nowMs: number): CodeCheck {
  if (record.consumed) return { ok: false, reason: 'already_used' };
  if (record.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (nowMs - record.createdAtMs > CODE_TTL_SECONDS * 1000) return { ok: false, reason: 'expired' };
  if (!matches) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
