/**
 * Reduce a full address label to a coarse area (e.g. "12 Allen Avenue, Ikeja, Lagos, Nigeria"
 * -> "Ikeja, Lagos"). Used in the pre-accept rider feed so exact pickup/drop-off streets are
 * NOT exposed to every online rider; the full address is revealed only after a rider accepts.
 * Pure and deterministic.
 */
export function coarseArea(address?: string | null): string {
  if (!address) return '';
  const parts = address
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !/^nigeria$/i.test(p)); // drop the country
  if (parts.length === 0) return '';
  return parts.slice(-2).join(', '); // last two meaningful parts: locality, state
}
