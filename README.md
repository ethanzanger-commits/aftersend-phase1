# AfterSend
Personal Gmail email lifecycle tracker (Chrome MV3 + Next.js + Supabase). Work in progress; see `docs/ARCHITECTURE.md` for status.

## Run the database tests (no accounts needed)
    npm install
    npm test
Tests run the migrations in an in-memory Postgres (PGlite) with a small Supabase shim (`tests/db/supabase-shim.sql`, test-only).

## Apply migrations to Supabase (manual)
Create a Supabase project, then run `supabase/migrations/*.sql` in the SQL editor, or use the Supabase CLI (`supabase link`, `supabase db push`).
