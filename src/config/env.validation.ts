import { z } from 'zod';

/**
 * Environment schema. The app refuses to boot if config is invalid or missing.
 * Secrets must come from the vault/env — never hard-coded (see 07-engineering-standards §3).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(1_209_600),
  FLW_SECRET_KEY: z.string().min(1),
  FLW_WEBHOOK_SECRET: z.string().min(1),
  FLW_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLW_PUBLIC_KEY: z.string().default(''),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  PAYMENT_DRIVER: z.enum(['fake', 'flutterwave']).default('fake'),
  DATA_ENCRYPTION_KEY: z.string().min(1),
  HASH_PEPPER: z.string().min(16),
  JOBS_QUOTE_SECRET: z.string().min(16),
  DB_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
