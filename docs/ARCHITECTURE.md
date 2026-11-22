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
| Schema, RLS, retention/deletion functions | Implemented. Tested locally (17 tests, PGlite Postgres) |
| Server-side Postgres functions (register, resolve token, record event, injected/confirm state machine) | Implemented. Tested locally (via the API integration tests) |
| API: pixel, tracked-link redirect, document landing page, register/injected/confirm-sent, purge cron, health | Implemented. 52 unit + integration tests; production build passes; live HTTP smoke test of non-database paths passed |
| Rate limiting | Implemented, best-effort only (per serverless instance, in-memory). Not a global limit |
| Bot/proxy labelling | Implemented as heuristics: opens are never labelled likely_human |
| Real Supabase health check (`/api/health?deep=1` against your project) | Verified manually: returned ok |
| Full flow against real Supabase (`npm run smoke`) | Script written and tested against a mock of Supabase; **not yet run against your real project** |
| Supabase Auth JWT check and PostgREST/RLS behaviour in real Supabase | **Not yet verified** until `npm run smoke` passes for you |
| Vercel deployment, cron | **Not yet verified** (manual) |
| Extension code: compose toggle, send interception, injection, confirm flow, dashboard, timeline, settings, notifications, follow-up reminders | Implemented. Core flow tested against a FAKE Gmail page (jsdom); build verified (permissions minimal, no secrets in bundle) |
| Behaviour in REAL Gmail (selectors, send-button events, "Message sent" detection, English UI only) | **Not verified**: use docs/EXTENSION_TEST_PLAN.md |
| Real Chrome notifications, alarms, extension sign-in | **Not verified** (needs Chrome) |
| Fallback when Gmail DOM is unsupported | Toggle refuses to arm and says so. A manual link-generator page is NOT built yet |
| Reply detection, bounce detection, Drive tracking, forward detection | Unsupported in MVP |

## Event ingestion
Public events (open_signal, link_clicked, document_visit) are recorded only by the public endpoints. The extension reports
only the lifecycle (`injected`, `confirm-sent`); there is no generic "post any event" endpoint, so events can't be forged by a client.
Events are ignored until the email is `send_confirmed`.

## Known limits
- The sender opening their own sent mail may produce an `open_signal` (indistinguishable from a recipient open). Phase 4 will add a "mark my own opens" aid.
- IP hashes rotate daily, so "same device across days" can't be inferred (intentional).
