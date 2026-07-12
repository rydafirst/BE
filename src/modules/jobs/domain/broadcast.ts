// Pure targeting logic for broadcasting a newly-available job to the online rider pool.
// No I/O — unit-tested in isolation.

// A single job never fans out to more than this many riders per broadcast, bounding push volume.
export const MAX_JOB_BROADCAST = 200;

/**
 * From the online riders, choose who to ping about a new job: de-duplicated, optionally excluding
 * one rider (e.g. the rider who just released this job, so they aren't re-offered their own drop),
 * and capped so a large pool can't trigger an unbounded fan-out.
 */
export function ridersToAnnounce(
  online: readonly string[],
  opts: { exclude?: string; cap?: number } = {},
): string[] {
  const cap = opts.cap ?? MAX_JOB_BROADCAST;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of online) {
    if (!id || id === opts.exclude || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}
