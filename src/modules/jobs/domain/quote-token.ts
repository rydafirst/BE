import { createHmac, timingSafeEqual } from 'node:crypto';

/** A quote is signed server-side and short-lived so the client cannot tamper with the price. */
export interface QuotePayload {
  type: 'DELIVERY' | 'RIDE';
  amountMinor: number; // kobo
  currency: 'NGN';
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  exp: number; // epoch ms expiry
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signQuote(payload: QuotePayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export type QuoteVerifyResult =
  | { ok: true; payload: QuotePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyQuote(token: string, secret: string, nowMs: number): QuoteVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  let payload: QuotePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuotePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
