# Deploying the Rydafirst backend to Railway

The app **refuses to boot on invalid/missing config** (fail-closed by design). Set the env vars
below and you won't hit the "Invalid environment configuration" crash. `railway.json` already
handles the build, start command, and health check — you only set variables.

---

## What's already wired for you (`railway.json`)

- **Builder:** Nixpacks. Build runs `npm run build` (which runs `prisma generate` then `nest build`).
- **Start:** runs `prisma migrate deploy` only when `DB_DRIVER=postgres`, then `node dist/main.js`.
- **Health check:** `GET /health/live` (version-neutral — not under `/v1`).
- App binds to `0.0.0.0` and reads Railway's injected `PORT` automatically.

---

## Path A — quickest deploy (memory mode, no database)

Good for a first live smoke test. **Data is in-memory and resets on every restart/redeploy** — fine
for a demo, not for real users.

Set these variables (Railway → your service → **Variables**):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | your web origin(s), comma-separated, e.g. `https://your-web.up.railway.app` |
| `JWT_ACCESS_SECRET` | random ≥16 chars — `openssl rand -hex 24` |
| `JWT_REFRESH_SECRET` | a **different** random ≥16 chars |
| `DATA_ENCRYPTION_KEY` | **base64 32-byte key** — `openssl rand -base64 32` |
| `HASH_PEPPER` | random ≥16 chars |
| `JOBS_QUOTE_SECRET` | random ≥16 chars |

`DB_DRIVER` defaults to `memory` and `PAYMENT_DRIVER` to `fake`, so you don't need DB or
Flutterwave keys for this path. That's it — deploy, then hit `https://<service>/health/live`.

---

## Path B — persistent data (Postgres + Redis)

1. In your Railway project, **+ New** → add **PostgreSQL** and **Redis** plugins.
2. Add all the Path A variables, **plus**:

| Variable | Value |
|---|---|
| `DB_DRIVER` | `postgres` |
| `DATABASE_URL` | reference the Postgres plugin's `DATABASE_URL` |
| `REDIS_URL` | reference the Redis plugin's `REDIS_URL` |

3. **Create the initial migration once, locally, and commit it** (Railway only *applies*
   migrations, it doesn't author them):
   ```bash
   cd backend
   DATABASE_URL="<your local or railway pg url>" npx prisma migrate dev --name init
   git add prisma/migrations && git commit -m "init migration"
   ```
   On deploy, the start command runs `prisma migrate deploy` automatically to create the tables.

---

## Path C — real payments (Flutterwave), on top of A or B

| Variable | Value |
|---|---|
| `PAYMENT_DRIVER` | `flutterwave` |
| `FLW_SECRET_KEY` | your Flutterwave secret key (`FLWSECK-...`) — **use TEST keys until you go live** |
| `FLW_WEBHOOK_SECRET` | the secret hash you set in the Flutterwave dashboard |
| `WEB_APP_URL` | your deployed web URL (used for the payment return redirect) |

Then in the Flutterwave dashboard set the webhook URL to:
`https://<your-railway-domain>/v1/webhooks/flutterwave`

---

## Path D — real OTP (SMS via Termii) + email (Resend)

By default OTPs log to the server console (`OTP_CHANNEL=console`) and email uses a console
fallback — no keys needed. To send for real:

| Variable | Value |
|---|---|
| `OTP_CHANNEL` | `sms` (send login codes over SMS; requires Termii key below) |
| `TERMII_API_KEY` | your Termii API key |
| `TERMII_SENDER_ID` | approved sender ID (default `Rydafirst`) |
| `RESEND_API_KEY` | your Resend API key (if set, real email is sent) |
| `EMAIL_FROM` | e.g. `Rydafirst <noreply@yourdomain>` (must be a Resend-verified domain) |

Fail-closed: `OTP_CHANNEL=sms` with no `TERMII_API_KEY` refuses to boot.

---

## After deploy — verify

- `GET https://<service>/health/live` → `{"status":"ok"}`
- Update the **web** app's `NEXT_PUBLIC_API_URL` to `https://<service>/v1`.
- Make sure `CORS_ORIGINS` includes the exact web origin (scheme + host, no trailing slash),
  otherwise the browser blocks API and socket calls.

## Common failure → cause

- **"Invalid environment configuration"** → a required var is missing/invalid. The log lists the
  exact field (e.g. `DATA_ENCRYPTION_KEY: must be a base64-encoded 32-byte key`). Fix that var.
- **Health check keeps failing** → make sure nothing overrode the start command; it must end at
  `node dist/main.js` and the app must reach "listening on :$PORT".
- **CORS / socket errors in the browser** → `CORS_ORIGINS` doesn't match the web origin exactly.
- **DB errors in Postgres mode** → you deployed before committing the init migration; create and
  commit it (Path B step 3), then redeploy.

## Generate all secrets at once

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 24)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 24)"
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "HASH_PEPPER=$(openssl rand -hex 24)"
echo "JOBS_QUOTE_SECRET=$(openssl rand -hex 24)"
```
