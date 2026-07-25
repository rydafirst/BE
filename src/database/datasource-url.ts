/**
 * Builds the Postgres connection string the Prisma client actually uses, layering pool-tuning
 * parameters onto the base `DATABASE_URL`.
 *
 * Kept as a PURE function — no Nest, no `process.env`, no I/O — so it is trivially unit-testable and
 * reusable by any caller (the Prisma client, one-off scripts, tests). This is the single place that
 * knows how pool settings are encoded onto the URL (Single Responsibility).
 *
 * Why it exists: on shared hosts (e.g. Railway) the database enforces a hard cap on concurrent
 * connections and can briefly slow down. `connection_limit` keeps our pool within that cap so the DB
 * never refuses connections; `pool_timeout` bounds how long a request waits for a free connection
 * before failing fast with a clean error instead of hanging (which the app layer then recovers from).
 *
 * An explicit value already present in the URL always wins — operators can override per-environment
 * straight in `DATABASE_URL` without code changes (Open/Closed).
 */
export interface PoolTuning {
  /** Max concurrent connections Prisma keeps open. Must fit within the database's own cap. */
  readonly connectionLimit: number;
  /** Seconds a query waits for a free pooled connection before erroring out. */
  readonly poolTimeoutSeconds: number;
}

export function buildDatasourceUrl(baseUrl: string, tuning: PoolTuning): string {
  const url = new URL(baseUrl);
  const setIfAbsent = (key: string, value: string): void => {
    // Respect an explicit override already in the URL; only fill in what the operator omitted.
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  };
  setIfAbsent('connection_limit', String(tuning.connectionLimit));
  setIfAbsent('pool_timeout', String(tuning.poolTimeoutSeconds));
  return url.toString();
}
