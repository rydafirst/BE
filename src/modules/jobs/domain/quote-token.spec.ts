import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signQuote, verifyQuote, type QuotePayload } from './quote-token.js';

const secret = 'test-secret-key';
const payload = (exp: number): QuotePayload => ({
  type: 'DELIVERY', amountMinor: 85_800, currency: 'NGN',
  pickup: { lat: 6.5, lng: 3.3 }, dropoff: { lat: 6.6, lng: 3.4 }, exp,
});

test('verifies a valid, unexpired token', () => {
  const token = signQuote(payload(2_000), secret);
  const r = verifyQuote(token, secret, 1_000);
  assert.ok(r.ok && r.payload.amountMinor === 85_800);
});

test('rejects a tampered amount (signature fails)', () => {
  const token = signQuote(payload(2_000), secret);
  const [body] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload(2_000), amountMinor: 1 })).toString('base64url');
  const tampered = `${forged}.${token.split('.')[1]}`;
  assert.equal(verifyQuote(tampered, secret, 1_000).ok, false);
  void body;
});

test('rejects an expired token', () => {
  const token = signQuote(payload(1_000), secret);
  const r = verifyQuote(token, secret, 5_000);
  assert.deepEqual(r, { ok: false, reason: 'expired' });
});

test('rejects a wrong-secret signature', () => {
  const token = signQuote(payload(2_000), secret);
  assert.equal(verifyQuote(token, 'other-secret', 1_000).ok, false);
});
