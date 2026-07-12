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
  // Infra URLs are only needed when DB_DRIVER=postgres (see refine below), so they're optional
  // here — this lets the app boot cleanly in memory mode (e.g. a first Railway deploy).
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(1_209_600),
  // Payment keys are only needed when PAYMENT_DRIVER=flutterwave (see refine below).
  FLW_SECRET_KEY: z.string().default(''),
  FLW_WEBHOOK_SECRET: z.string().default(''),
  FLW_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLW_PUBLIC_KEY: z.string().default(''),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  PAYMENT_DRIVER: z.enum(['fake', 'flutterwave']).default('fake'),
  // AES-256-GCM key: must decode from base64 to exactly 32 bytes. Validated here so a bad key
  // fails fast with a clear message at boot (generate with: openssl rand -base64 32).
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => { try { return Buffer.from(v, 'base64').length === 32; } catch { return false; } },
      'must be a base64-encoded 32-byte key (generate: openssl rand -base64 32)'),
  HASH_PEPPER: z.string().min(16),
  JOBS_QUOTE_SECRET: z.string().min(16),
  DB_DRIVER: z.enum(['memory', 'postgres']).default('memory'),

  // How long an unpaid order stays open before it auto-cancels (no funds captured, so it's safe).
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(20),

  // Geofence radius (metres) a rider must be within to confirm pickup/arrival. Generous by
  // default to tolerate urban GPS drift; tighten only if you see abuse.
  ARRIVAL_RADIUS_M: z.coerce.number().int().positive().default(120),

  // --- OTP delivery ---------------------------------------------------------
  // How the login OTP reaches the user. `console` (dev) logs it; `email` sends via Resend;
  // `sms` sends via Termii (blocked pending business registration).
  OTP_CHANNEL: z.enum(['console', 'sms', 'email']).default('console'),
  // Max OTP code requests per phone per hour. Raise while testing (e.g. 100); keep low in production.
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  TERMII_API_KEY: z.string().default(''),
  TERMII_SENDER_ID: z.string().default('Rydafirst'),
  TERMII_BASE_URL: z.string().url().default('https://api.ng.termii.com'),

  // --- Transactional email (Resend) ----------------------------------------
  // If RESEND_API_KEY is set, real emails are sent; otherwise emails log to the console.
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Rydafirst <onboarding@resend.dev>'),

  // --- App Store reviewer login --------------------------------------------
  // Lets Apple's App Review sign in to this OTP-only app without receiving a live code.
  // ACTIVE ONLY when BOTH are set (fail-closed). The phone is an ordinary account with no
  // elevated privileges; the fixed code is what you enter in App Store Connect > Sign-In Info.
  // Leave both empty in normal operation.
  REVIEW_LOGIN_PHONE: z.string().default(''),
  REVIEW_LOGIN_OTP: z.string().default(''),
}).superRefine((env, ctx) => {
  // Fail-closed: if you turn on Postgres, the infra URLs must be present and valid.
  if (env.DB_DRIVER === 'postgres') {
    if (!env.DATABASE_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'required when DB_DRIVER=postgres' });
    if (!env.REDIS_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REDIS_URL'], message: 'required when DB_DRIVER=postgres' });
  }
  // Fail-closed: if you turn on real payments, the Flutterwave keys must be present.
  if (env.PAYMENT_DRIVER === 'flutterwave') {
    if (!env.FLW_SECRET_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FLW_SECRET_KEY'], message: 'required when PAYMENT_DRIVER=flutterwave' });
    if (!env.FLW_WEBHOOK_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FLW_WEBHOOK_SECRET'], message: 'required when PAYMENT_DRIVER=flutterwave' });
  }
  // Fail-closed: if OTPs go out over SMS, the Termii key must be present.
  if (env.OTP_CHANNEL === 'sms' && !env.TERMII_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TERMII_API_KEY'], message: 'required when OTP_CHANNEL=sms' });
  }
  // Fail-closed: reviewer login must have BOTH a phone and a fixed 4-8 digit code, or neither.
  const reviewPhoneSet = env.REVIEW_LOGIN_PHONE.length > 0;
  const reviewOtpSet = env.REVIEW_LOGIN_OTP.length > 0;
  if (reviewPhoneSet !== reviewOtpSet) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REVIEW_LOGIN_OTP'], message: 'REVIEW_LOGIN_PHONE and REVIEW_LOGIN_OTP must be set together' });
  }
  if (reviewOtpSet && !/^\d{4,8}$/.test(env.REVIEW_LOGIN_OTP)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REVIEW_LOGIN_OTP'], message: 'must be 4-8 digits' });
  }
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
