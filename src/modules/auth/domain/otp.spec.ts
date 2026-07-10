import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOtp, generateOtp, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, type OtpRecord } from './otp.js';

const base = (over: Partial<OtpRecord> = {}): OtpRecord => ({
  codeHash: 'h', createdAtMs: 1_000, attempts: 0, consumed: false, ...over,
});

test('generated OTP is the right length and numeric', () => {
  const c = generateOtp();
  assert.equal(c.length, OTP_LENGTH);
  assert.match(c, /^[0-9]+$/);
});

test('accepts a fresh, matching, unused code', () => {
  assert.deepEqual(checkOtp(base(), true, 1_000), { ok: true });
});

test('rejects expired', () => {
  const r = checkOtp(base(), true, 1_000 + OTP_TTL_SECONDS * 1000 + 1);
  assert.deepEqual(r, { ok: false, reason: 'expired' });
});

test('rejects after too many attempts (brute-force lockout)', () => {
  assert.deepEqual(checkOtp(base({ attempts: OTP_MAX_ATTEMPTS }), true, 1_000), {
    ok: false, reason: 'too_many_attempts',
  });
});

test('rejects reuse of a consumed code', () => {
  assert.deepEqual(checkOtp(base({ consumed: true }), true, 1_000), { ok: false, reason: 'already_used' });
});

test('rejects a mismatch', () => {
  assert.deepEqual(checkOtp(base(), false, 1_000), { ok: false, reason: 'mismatch' });
});
