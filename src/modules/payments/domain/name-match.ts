/**
 * Fuzzy business-name matcher for vendor payouts.
 *
 * A customer names a shop casually ("Sola Store", "Shoprite Lekki") while the bank account resolves to
 * the registered entity ("SOLASHINE VENTURES LTD", "RETAIL SUPERMARKETS NIG LTD"). Requiring equality
 * would block almost every legitimate payout, so we normalise (drop punctuation + generic business
 * words) and measure token overlap, treating prefix matches as hits ("sola" ⊂ "solashine").
 *
 * This is a GUARD, not the sole control: a high score lets the flow suggest "this looks right", but the
 * customer still confirms the resolved name before any payout, and low scores route to manual review.
 * Pure + deterministic so it is unit-tested in isolation.
 */

// Generic tokens that carry no identifying signal for a Nigerian business name.
const STOP = new Set([
  'ltd', 'limited', 'plc', 'ventures', 'venture', 'enterprise', 'enterprises', 'nig', 'nigeria',
  'company', 'co', 'and', 'the', 'global', 'services', 'service', 'intl', 'international', 'stores',
  'store', 'shop', 'shops', 'ng',
]);

export function normalizeName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/** Two tokens match if equal, or one is a prefix of the other (min length 3) — catches "sola"/"solashine". */
function tokenMatch(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return false;
}

/** Proportion of the SMALLER name's tokens that find a match in the other. Range [0, 1]. */
export function nameMatchScore(expected: string, resolved: string): number {
  const a = normalizeName(expected);
  const b = normalizeName(resolved);
  if (a.length === 0 || b.length === 0) return 0;
  let overlap = 0;
  for (const w of a) if (b.some((v) => tokenMatch(w, v))) overlap += 1;
  return overlap / Math.min(a.length, b.length);
}

/** Default auto-suggest threshold; below this the flow should force manual/customer confirmation. */
export const NAME_MATCH_THRESHOLD = 0.5;

export function namesMatch(expected: string, resolved: string): boolean {
  return nameMatchScore(expected, resolved) >= NAME_MATCH_THRESHOLD;
}
