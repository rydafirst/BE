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
  // Optional forward proxy for ALL outbound Flutterwave calls. Flutterwave's Transfers (payout) API
  // requires IP whitelisting, but shared hosts (e.g. Railway without a Pro static IP) have no stable
  // outbound IPv4. Point this at a proxy with a dedicated IPv4 (QuotaGuard/Fixie/self-hosted) and
  // whitelist that proxy IP in Flutterwave. Empty = connect directly (dev / hosts with a static IP).
  FLW_PROXY_URL: z.string().default(''),
  // Which payment methods the hosted checkout offers, comma-separated (Flutterwave `payment_options`).
  // Empty = show EVERY enabled method and let the customer choose — the right default for Nigeria,
  // where bank transfer is the most-used method. Only set this to restrict methods for a specific
  // reason (e.g. temporarily hiding a broken one); leave empty otherwise.
  FLW_PAYMENT_OPTIONS: z.string().default(''),
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
  // Postgres connection-pool tuning, appended to DATABASE_URL at boot (see database/datasource-url.ts).
  // On shared hosts the DB caps concurrent connections and can briefly stall; these bound our pool so
  // the DB never refuses connections and a busy moment fails fast & cleanly instead of hanging. Keep
  // DB_CONNECTION_LIMIT at or below the database plan's own connection cap. An explicit value in
  // DATABASE_URL overrides these. Defaults are conservative and safe for a single Railway instance.
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  DB_POOL_TIMEOUT: z.coerce.number().int().positive().default(20),
  // 'expo' sends real push notifications via the Expo push service; 'dev' just logs them.
  PUSH_DRIVER: z.enum(['dev', 'expo']).default('dev'),
  // Admin allowlist: comma-separated phone numbers granted ADMIN + all review scopes on login.
  // No self-service admin signup — provisioning is explicit and auditable.
  ADMIN_PHONES: z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // --- Rider onboarding / documents ----------------------------------------
  // Operating city — decides which permits (LASDRI/LASRRA/hackney/keke) become required documents.
  LAUNCH_CITY: z.enum(['LAGOS', 'ABUJA', 'PORT_HARCOURT', 'OTHER']).default('LAGOS'),
  // Whether a guarantor document is required to onboard (off by default; mirrors Uber/Bolt).
  REQUIRE_GUARANTOR: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Fail-closed rider gate: when 'true' (default) a rider must have all documents approved before
  // they can go online OR accept a job. Set 'false' only for a staged rollout before the document
  // pipeline is live (e.g. R2 not yet configured) — it re-opens the gate, so keep it on in prod.
  ENFORCE_RIDER_CLEARANCE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Where document images live: 'memory' (dev) or 'r2' (Cloudflare R2 / S3-compatible, prod).
  DOCUMENT_STORE_DRIVER: z.enum(['memory', 'r2']).default('memory'),
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),

  // How long an unpaid order stays open before it auto-cancels (no funds captured, so it's safe).
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(20),

  // Geofence radius (metres) a rider must be within to confirm pickup/arrival. Generous by
  // default to tolerate urban GPS drift; tighten only if you see abuse.
  ARRIVAL_RADIUS_M: z.coerce.number().int().positive().default(120),

  // --- Maps / address search -----------------------------------------------
  // Google Maps Web Service key, used SERVER-SIDE only to proxy Places autocomplete/details and
  // reverse geocoding for the mobile app (the key must never ship inside the app, where it can be
  // extracted and abused). Empty in dev falls back to the client's on-device geocoder.
  GOOGLE_MAPS_API_KEY: z.string().default(''),
  // Road-routing service base URL used SERVER-SIDE to draw the on-map route between two points. Keyless
  // by default (public OSRM demo server) so nothing secret ships in the app. The public server is
  // rate-limited and not for heavy production traffic — point this at a self-hosted OSRM (or a keyed
  // provider behind an adapter) as volume grows; no app change needed.
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),

  // --- OTP delivery ---------------------------------------------------------
  // How the login OTP reaches the user. `console` (dev) logs it; `email` sends via Resend;
  // `sms` sends the code by text — the primary channel now that our Termii sender ID is approved.
  OTP_CHANNEL: z.enum(['console', 'sms', 'email']).default('console'),
  // Which SMS gateway delivers the code when OTP_CHANNEL=sms. `termii` (default, Nigeria-focused,
  // sender ID approved) or `africastalking` (alternate/fallback gateway). Nothing else changes when
  // you switch — the auth flow talks to a single OtpSender port.
  SMS_PROVIDER: z.enum(['termii', 'africastalking']).default('termii'),
  // Max OTP code requests per phone per hour. Raise while testing (e.g. 100); keep low in production.
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  TERMII_API_KEY: z.string().default(''),
  // The APPROVED Termii sender ID. Our brand-name request ("rydafirst") was declined, so we send on
  // the approved transactional ID. Override per environment via TERMII_SENDER_ID.
  TERMII_SENDER_ID: z.string().default('OE Alert'),
  TERMII_BASE_URL: z.string().url().default('https://api.ng.termii.com'),
  // Termii delivery route. Nigerian numbers are mostly on Do-Not-Disturb, so the `dnd` route is the
  // one that actually delivers OTP (the `generic` route is often not enabled for NG workspaces and
  // returns a 422 "route not configured"). Change only if Termii tells you a different route is enabled.
  TERMII_CHANNEL: z.enum(['dnd', 'generic', 'whatsapp']).default('dnd'),
  // Africa's Talking SMS (reuses AT_USERNAME/AT_API_KEY from voice masking below). Sender ID is
  // optional — leave empty to send from AT's shared shortcode until a branded ID is approved.
  AT_SMS_SENDER_ID: z.string().default(''),
  AT_SMS_BASE_URL: z.string().url().default('https://api.africastalking.com'),

  // --- Voice masking (Africa's Talking) ------------------------------------
  // In-app calling that hides both parties' real numbers. Masking is active ONLY when the AT
  // credentials + a voice-enabled number are all set AND VOICE_CALLBACK_SECRET is present; otherwise
  // the apps fall back to the current direct `tel:` dialing with no behaviour change.
  AT_USERNAME: z.string().default(''),
  AT_API_KEY: z.string().default(''),
  AT_VOICE_NUMBER: z.string().default(''),
  AT_VOICE_BASE_URL: z.string().url().default('https://voice.africastalking.com'),
  // Unguessable secret path segment on the AT voice callback URL; only AT (holding the full URL) can
  // drive a bridge, and it is validated on every callback before any number is dialled.
  VOICE_CALLBACK_SECRET: z.string().default(''),

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
  // Additional reviewer identities as a comma-separated list of `phone:code` pairs, so you can give
  // Apple/Google a separate demo account per flow, e.g.
  //   REVIEW_LOGINS=+2348011111111:246810,+2348022222222:135791
  // Each is an ORDINARY account (keep these numbers out of ADMIN_PHONES, or they'll be admins and
  // every customer/rider screen will 403 for the reviewer).
  REVIEW_LOGINS: z.string().default(''),
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
    // WEB_APP_URL is the address Flutterwave redirects a WEB customer back to after paying. Left at
    // the localhost dev default in production, every web payment would redirect to an unreachable
    // page. Refuse to boot so it can't ship silently broken. (Mobile is unaffected — it redirects to
    // the rydafirst:// deep link, not this URL.)
    if (/localhost|127\.0\.0\.1/.test(env.WEB_APP_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEB_APP_URL'], message: 'must be the real web domain (not localhost) when PAYMENT_DRIVER=flutterwave — it is the post-payment redirect URL' });
    }
  }
  // Fail-closed: if documents go to R2, all R2 credentials must be present.
  if (env.DOCUMENT_STORE_DRIVER === 'r2') {
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
      if (!env[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: 'required when DOCUMENT_STORE_DRIVER=r2' });
    }
  }
  // Fail-closed: if OTPs go out over SMS, the selected gateway's credentials must be present.
  if (env.OTP_CHANNEL === 'sms') {
    if (env.SMS_PROVIDER === 'termii' && !env.TERMII_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TERMII_API_KEY'], message: 'required when OTP_CHANNEL=sms and SMS_PROVIDER=termii' });
    }
    if (env.SMS_PROVIDER === 'africastalking') {
      if (!env.AT_USERNAME) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AT_USERNAME'], message: 'required when OTP_CHANNEL=sms and SMS_PROVIDER=africastalking' });
      if (!env.AT_API_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AT_API_KEY'], message: 'required when OTP_CHANNEL=sms and SMS_PROVIDER=africastalking' });
    }
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
  // Fail fast on a malformed reviewer list so a typo can't silently lock a reviewer out.
  for (const entry of env.REVIEW_LOGINS.split(',')) {
    const e = entry.trim();
    if (!e) continue;
    if (!/^\+?[\d\s-]+:\d{4,8}$/.test(e)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['REVIEW_LOGINS'],
        message: `invalid entry "${e}" — expected phone:code with a 4-8 digit code (e.g. +2348011111111:246810)`,
      });
    }
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
