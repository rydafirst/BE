/**
 * Normalise a Nigerian phone number to bare international E.164 digits (no '+'), e.g. 2348012345678.
 * Providers (Termii, Africa's Talking) reject local `080…` format as "not dialable" — they need the
 * country code. Accepts local (`080…`), international (`234…`), `+234…`, or a 10-digit subscriber
 * number and returns a consistent `234XXXXXXXXXX`. Non-Nigerian inputs already in digits pass through.
 */
export function toNgE164(phone: string): string {
  const d = (phone || '').replace(/\D/g, ''); // digits only (drops +, spaces, dashes)
  if (d.startsWith('234')) return d; // already international
  if (d.startsWith('0')) return '234' + d.slice(1); // local 080… -> 23480…
  if (d.length === 10) return '234' + d; // 80… (no leading 0) -> 23480…
  return d; // fall back: already-clean digits we don't recognise as NG-local
}
