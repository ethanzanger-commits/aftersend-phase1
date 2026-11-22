# AfterSend architecture

Three isolated layers:

| Layer | Path | Holds | Never holds |
|---|---|---|---|
| Extension (MV3, TS+React) | `apps/extension` | Supabase *anon* key, user session, Gmail DOM adapter | service-role key, email bodies |
| Tracking API (Next.js on Vercel) | `apps/api` | service-role key, IP salt, rate limits | UI |
| Database (Supabase Postgres + RLS) | `supabase/` | metadata only, hashed tokens | email bodies, raw IPs/UAs |

Flow: compose toggle -> `POST /api/emails` registers (status `registered`, returns pixel/link URLs once) -> extension injects
and verifies the injection (`injected`) -> after Gmail confirms the send, extension calls confirm (`send_confirmed`).
Only `send_confirmed` is ever displayed as "tracked". Recipients open/click -> public endpoints record events.
The extension reads events directly from Supabase with the user's JWT (RLS-scoped).

## Key decisions
- Tokens: 128-bit random, only SHA-256 stored. Clients can read/delete their rows but never write tracking tables.
- Event source/type pairs are enforced by DB CHECK constraints. `reply_received` / `bounce_detected` exist but are unsupported.
- Retention: `purge_expired_data()` (cron, service role). Deletion: `delete_my_tracking_data()` or delete a row (cascades).

## Risks
- Open pixels are weak signals: Apple Mail Privacy Protection and Gmail's image proxy prefetch images; scanners fetch links. Label as `uncertain`/`likely_automated`.
- The sender's own browser may load the pixel while composing/viewing Sent; events before `send_confirmed` must not count as opens.
- Gmail's DOM is undocumented and changes; selectors live in one compatibility layer with a copy-link fallback.
- Forwards and PDF attachment views are not detectable. Drive view events are unverified, so they are out of the MVP.
- Redirect endpoints are open-redirect targets if URLs aren't validated; only destinations stored at registration (http/https) are served.

## Feature status
| Feature | Status |
|---|---|
| Schema, RLS, retention/deletion functions | Implemented and tested (17 tests, local PGlite Postgres) |
| Applying migrations to real Supabase / RLS with real Supabase Auth | Not yet verified (manual step) |
| Tracking API, pixel, redirects, landing page | Not started |
| Extension, Gmail compose toggle, notifications, dashboard | Not started |
| Reply detection, bounce detection, Drive tracking, forward detection | Unsupported in MVP |
