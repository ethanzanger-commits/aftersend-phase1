import { z } from 'zod';
import type { Deps } from './deps';
import { TOKEN_RE, newToken, hashToken, hashIp, safeEqual } from './tokens';
import { validateDestination } from './validate-url';
import { classify, uaFamily, type EventKind } from './classify';
import { GIF, UUID_RE, escapeHtml, clientIp, corsHeaders, json } from './http';
import type { Resolved } from './store';

const PUBLIC_LIMIT = { limit: 120, windowMs: 60_000 };
const OPEN_BUCKET_MS = 5 * 60_000;
const CLICK_BUCKET_MS = 60_000;

// ---------- shared: record a public event (opens, clicks, landing visits) ----------
async function recordPublicEvent(d: Deps, req: Request, kind: EventKind, r: Resolved): Promise<void> {
  const now = d.now();
  const ipHash = hashIp(clientIp(req), d.config.ipSalt, now);
  if (!d.limiter.hit(`pub:${ipHash}`, PUBLIC_LIMIT.limit, PUBLIC_LIMIT.windowMs)) return; // over limit: serve content, record nothing
  // Events before the send is confirmed (e.g. the sender previewing the draft) are never recorded.
  if (r.status !== 'send_confirmed') return;
  const sentAt = r.send_confirmed_at ? new Date(r.send_confirmed_at).getTime() : null;
  const secs = sentAt === null ? null : (now.getTime() - sentAt) / 1000;
  const c = classify(kind, req.headers.get('user-agent'), secs);
  const bucket = Math.floor(now.getTime() / (kind === 'open_signal' ? OPEN_BUCKET_MS : CLICK_BUCKET_MS));
  const target = kind === 'open_signal' ? r.email_id : r.target_id;
  await d.store.recordEvent({
    emailId: r.email_id, userId: r.user_id, type: kind,
    source: kind === 'open_signal' ? 'pixel' : kind === 'link_clicked' ? 'redirect' : 'landing_page',
    linkId: kind === 'link_clicked' ? r.target_id : null, documentId: kind === 'document_visit' ? r.target_id : null,
    confidence: c.confidence, reason: c.reason, uaFamily: c.uaFamily, ipHash,
    dedupe: `${kind}:${target}:${bucket}:${ipHash.slice(0, 16)}:${c.uaFamily}`, occurred: now,
  });
}

const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error('event_record_failed', e instanceof Error ? e.name : 'error'); } };

// ---------- GET /api/health ----------
export async function handleHealth(d: Deps | null, req: Request): Promise<Response> {
  const deep = new URL(req.url).searchParams.get('deep') === '1';
  if (!deep) return json(null, req, 200, { status: 'ok' });
  if (!d) return json(null, req, 503, { status: 'misconfigured' });
  const dbOk = await d.store.ping().catch(() => false);
  return json(null, req, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'database_unreachable' });
}

// ---------- GET /api/t/<token>.gif  (transparent pixel) ----------
export async function handlePixel(d: Deps, req: Request, file: string): Promise<Response> {
  const token = file.replace(/\.gif$/i, '');
  if (TOKEN_RE.test(token)) {
    await safe(async () => {
      const r = await d.store.resolveToken('pixel', hashToken(token));
      if (r) await recordPublicEvent(d, req, 'open_signal', r);
    });
  }
  // Same response whether or not the token exists or was recorded: never leaks token validity.
  return new Response(GIF, { status: 200, headers: {
    'content-type': 'image/gif', 'content-length': String(GIF.length),
    'cache-control': 'no-store, no-cache, must-revalidate, private', pragma: 'no-cache', expires: '0',
    'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin' } });
}

// ---------- GET /api/l/<token>  (tracked link redirect) ----------
export async function handleLink(d: Deps, req: Request, token: string): Promise<Response> {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!TOKEN_RE.test(token)) return notFound();
  const r = await d.store.resolveToken('link', hashToken(token));
  if (!r || !r.destination_url) return notFound();
  const host = new URL(d.config.baseUrl).hostname;
  const v = validateDestination(r.destination_url, { blockedHosts: [host] }); // re-validated at redirect time
  if (!v.ok) return notFound();
  await safe(() => recordPublicEvent(d, req, 'link_clicked', r));
  return new Response(null, { status: 302, headers: { location: v.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

// ---------- GET /d/<token>  (document landing page) ----------
export async function handleDocument(d: Deps, req: Request, token: string): Promise<Response> {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const notFound = () => new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not available.</p>', { status: 404, headers });
  if (!TOKEN_RE.test(token)) return notFound();
  const r = await d.store.resolveToken('document', hashToken(token));
  if (!r || !r.destination_url) return notFound();
  const v = validateDestination(r.destination_url, { blockedHosts: [new URL(d.config.baseUrl).hostname] });
  if (!v.ok) return notFound();
  await safe(() => recordPublicEvent(d, req, 'document_visit', r));
  const title = escapeHtml(r.title ?? 'Document');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#f7f7f8;color:#111}
main{background:#fff;padding:2rem;border-radius:12px;max-width:28rem;box-shadow:0 1px 4px #0002;text-align:center}
a.b{display:inline-block;margin-top:1rem;padding:.7rem 1.2rem;background:#111;color:#fff;border-radius:8px;text-decoration:none}
small{display:block;margin-top:1.5rem;color:#666}</style></head><body><main><h1>${title}</h1>
<a class="b" href="${escapeHtml(v.url)}" rel="noopener noreferrer nofollow">Open document</a>
<small>The sender is notified that this page was visited. Only a coarse browser type is recorded, not your name or address.</small></main></body></html>`;
  return new Response(html, { status: 200, headers });
}

// ---------- extension-facing endpoints (Bearer JWT) ----------
const emailSchema = z.object({
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(50).default([]),
  subject: z.string().max(500).nullish(),
  links: z.array(z.object({ url: z.string().max(2048), label: z.string().max(100).nullish() })).max(50).default([]),
  documents: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().max(2048) })).max(10).default([]),
});

async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown | undefined> {
  const text = await req.text();
  if (text.length > maxBytes) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export function handleOptions(d: Deps, req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(d, req) });
}

// POST /api/emails : register a tracked email, receive tokens ONCE.
export async function handleRegister(d: Deps, req: Request): Promise<Response> {
  const userId = await d.authenticate(req);
  if (!userId) return json(d, req, 401, { error: 'unauthorized' });
  if (!d.limiter.hit(`reg:${userId}`, 60, 60_000)) return json(d, req, 429, { error: 'rate_limited' });
  const parsed = emailSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(d, req, 400, { error: 'invalid_request' });
  const body = parsed.data;
  const blocked = [new URL(d.config.baseUrl).hostname];

  const rejected: { url: string; reason: string }[] = [];
  const byUrl = new Map<string, { token: string; label: string | null; original: string[] }>();
  for (const l of body.links) {
    const v = validateDestination(l.url, { blockedHosts: blocked });
    if (!v.ok) { rejected.push({ url: l.url.slice(0, 200), reason: v.reason }); continue; }
    const ex = byUrl.get(v.url);
    if (ex) ex.original.push(l.url); else byUrl.set(v.url, { token: newToken(), label: l.label ?? null, original: [l.url] });
  }
  const docs: { token: string; title: string; url: string }[] = [];
  for (const doc of body.documents) {
    const v = validateDestination(doc.url, { blockedHosts: blocked });
    if (!v.ok) { rejected.push({ url: doc.url.slice(0, 200), reason: v.reason }); continue; }
    docs.push({ token: newToken(), title: doc.title, url: v.url });
  }
  const pixelToken = newToken();
  const emailId = await d.store.registerEmail({
    userId, pixelHash: hashToken(pixelToken), recipients: body.recipients, subject: body.subject ?? null,
    links: [...byUrl].map(([url, x]) => ({ hash: hashToken(x.token), url, label: x.label })),
    documents: docs.map((x) => ({ hash: hashToken(x.token), title: x.title, url: x.url })),
  });
  const base = d.config.baseUrl;
  return json(d, req, 201, {
    email_id: emailId, status: 'registered',
    pixel_url: `${base}/api/t/${pixelToken}.gif`,
    links: [...byUrl].map(([url, x]) => ({ destination_url: url, original_urls: x.original, tracked_url: `${base}/api/l/${x.token}` })),
    documents: docs.map((x) => ({ title: x.title, landing_url: `${base}/d/${x.token}` })),
    rejected,
  });
}

// POST /api/emails/<id>/injected : extension reports what it actually injected into the compose body.
export async function handleInjected(d: Deps, req: Request, id: string): Promise<Response> {
  const userId = await d.authenticate(req);
  if (!userId) return json(d, req, 401, { error: 'unauthorized' });
  if (!UUID_RE.test(id)) return json(d, req, 404, { error: 'not_found' });
  if (!d.limiter.hit(`inj:${userId}`, 120, 60_000)) return json(d, req, 429, { error: 'rate_limited' });
  const p = z.object({ pixel_injected: z.boolean(), links_rewritten: z.number().int().min(0).max(50) }).safeParse(await readJson(req));
  if (!p.success) return json(d, req, 400, { error: 'invalid_request' });
  const ok = await d.store.markInjected({ userId, emailId: id, pixelInjected: p.data.pixel_injected, linksRewritten: p.data.links_rewritten });
  return ok ? json(d, req, 200, { status: 'injected' }) : json(d, req, 409, { error: 'cannot_mark_injected' });
}

// POST /api/emails/<id>/confirm-sent : extension saw Gmail actually send the message.
export async function handleConfirmSent(d: Deps, req: Request, id: string): Promise<Response> {
  const userId = await d.authenticate(req);
  if (!userId) return json(d, req, 401, { error: 'unauthorized' });
  if (!UUID_RE.test(id)) return json(d, req, 404, { error: 'not_found' });
  if (!d.limiter.hit(`conf:${userId}`, 120, 60_000)) return json(d, req, 429, { error: 'rate_limited' });
  const status = await d.store.confirmSent({ userId, emailId: id });
  return status ? json(d, req, 200, { status }) : json(d, req, 409, { error: 'tracking_not_verified', message: 'Injection must be recorded before the send can be confirmed.' });
}

// GET /api/cron/purge : Vercel Cron sends "Authorization: Bearer $CRON_SECRET".
export async function handlePurge(d: Deps, req: Request): Promise<Response> {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m || !safeEqual(m[1], d.config.cronSecret)) return json(null, req, 401, { error: 'unauthorized' });
  return json(null, req, 200, { purged: await d.store.purgeExpired() });
}
export { uaFamily };
