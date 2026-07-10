# Running Rydafirst backend locally

## 1. Fast path — no database (in-memory)
Runs everything on in-memory adapters; great for domain work and the test suite.
```bash
cd backend
cp .env.example .env          # set secrets (>=16 chars for pepper/quote/jwt)
npm install
npm test                      # domain + journey tests (no DB needed)
DB_DRIVER=memory npm run start:dev
```

## 2. Full path — Postgres + Redis
```bash
# from repo root: start infra
docker compose -f infra/docker-compose.yml up -d

cd backend
cp .env.example .env          # DATABASE_URL/REDIS_URL already match docker-compose
npm install
npx prisma generate
npx prisma migrate dev --name init   # creates tables from prisma/schema.prisma
npm run db:seed                      # optional: admin user
DB_DRIVER=postgres npm run start:dev
```

## Health
- `GET http://localhost:4000/v1/health/live` → `{ status: "ok" }`

## Notes
- `DB_DRIVER=memory` (default) uses in-memory adapters; `postgres` uses Prisma + Redis.
- Payments: set real `FLW_SECRET_KEY` / `FLW_WEBHOOK_SECRET`; confirm escrow request bodies
  against your live Flutterwave merchant docs before go-live (see adapters/flutterwave.provider.ts).
- Secrets belong in a vault in staging/prod — never commit `.env`.
