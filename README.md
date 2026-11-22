# AfterSend
Personal Gmail email lifecycle tracker (Chrome MV3 + Next.js + Supabase). Work in progress: see `docs/ARCHITECTURE.md` for exactly what is implemented, tested and unsupported.

## Run all tests (no accounts needed)
    npm install
    npm test            # DB schema/RLS tests + API unit and integration tests (in-memory Postgres via PGlite)
    npm run typecheck
    npm run build       # builds the Next.js API

Tests apply the real migrations to an in-memory Postgres with a tiny Supabase shim (`tests/db/supabase-shim.sql`, test-only).

## Supabase (manual)
Run, in order, in the SQL Editor (or `supabase db push`):
1. `supabase/migrations/20261028000001_init_schema.sql`
2. `supabase/migrations/20261028000002_api_functions.sql`

## Run the API locally against your Supabase (manual)
    cp .env.example apps/api/.env.local     # fill in real values; never commit
    npm run dev -w @aftersend/api
Secrets: generate with `openssl rand -hex 32` for IP_HASH_SALT and CRON_SECRET.
Check `http://localhost:3000/api/health?deep=1` returns `{"status":"ok"}`.

## Deploy to Vercel (manual, later)
Import the repo, set **Root Directory** to `apps/api`, add the server env vars from `.env.example`. `vercel.json` schedules the daily retention purge.

## Smoke test against your real Supabase (manual)
With `apps/api/.env.local` filled in and the Supabase publishable key at hand:

    npm install
    npm run smoke

It starts the server, creates two throwaway test users, runs the whole tracking flow, checks privacy rules, deletes the test users and
prints PASS/FAIL. It asks for the publishable key (hidden) and never prints keys. `npm run test:smoke` runs the same script against a
local mock of Supabase (no accounts needed) and is how the script itself is tested.

## Chrome extension
    npm run setup:extension     # asks for your PUBLISHABLE key (hidden); refuses secret keys
    npm run build:extension     # builds apps/extension/dist
Then Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> choose `apps/extension/dist`.
Click the AfterSend icon to sign in and open the dashboard. Follow `docs/EXTENSION_TEST_PLAN.md` to test in real Gmail.
The extension talks to `EXT_API_BASE_URL` (default `http://localhost:3000`): keep `npm run dev -w @aftersend/api` running while testing.
Deploy the API to Vercel before real recipients can load the pixel.
