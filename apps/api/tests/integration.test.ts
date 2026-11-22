import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, sys, makeUser } from '../../../tests/db/helpers';
import { createRpcStore, type Rpc } from '../src/store';
import { createMemoryLimiter } from '../src/rate-limit';
import type { Deps } from '../src/deps';
import { handleRegister, handleInjected, handleConfirmSent, handlePixel, handleLink, handleDocument, handlePurge, handleHealth, handleOptions } from '../src/handlers';

const BASE = 'https://track.example.com';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CRON = 'c'.repeat(40);

let db: PGlite; let alice: string; let bob: string; let clock: Date;
let deps: Deps;

const pgliteRpc = (db: PGlite): Rpc => async (fn, args) => {
  const keys = Object.keys(args);
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  return (await db.query<any>(`select * from public.${fn}(${named})`, keys.map((k) => args[k]))).rows;
};

const authAs = (uid: string | null) => async (req: Request) => (req.headers.get('authorization') === 'Bearer test-' + uid ? uid : null);
const req = (url: string, init: RequestInit & { ip?: string } = {}) =>
  new Request(url, { ...init, headers: { 'user-agent': CHROME, 'x-forwarded-for': init.ip ?? '203.0.113.7', ...(init.headers as object) } });
const post = (path: string, uid: string | null, body: unknown) =>
  req(BASE + path, { method: 'POST', body: JSON.stringify(body), headers: uid ? { authorization: 'Bearer test-' + uid } : {} });
const tokenOf = (url: string) => url.split('/').pop()!.replace('.gif', '');
const events = async (type?: string) => (await sys(db, `select * from public.email_events ${type ? `where event_type='${type}'` : ''} order by created_at`)).rows;

beforeAll(async () => { db = await createDb(); });
beforeEach(async () => {
  await sys(db, 'delete from auth.users');
  alice = await makeUser(db, 'a@example.com'); bob = await makeUser(db, 'b@example.com');
  clock = new Date(); // DB stamps send_confirmed_at with real now(), so the test clock must start there
  deps = {
    config: { baseUrl: BASE, ipSalt: 's'.repeat(32), cronSecret: CRON, allowedOrigins: ['chrome-extension://abc'] },
    store: createRpcStore(pgliteRpc(db)), limiter: createMemoryLimiter(() => clock.getTime()), now: () => clock,
    authenticate: (r) => authAs(alice)(r).then((x) => x ?? authAs(bob)(r)),
  };
});

async function registerSample() {
  const res = await handleRegister(deps, post('/api/emails', alice, {
    recipients: ['Bob@Example.com'], subject: 'Intro',
    links: [{ url: 'https://example.com/portfolio', label: 'Portfolio' }, { url: 'https://example.com/portfolio' }, { url: 'javascript:alert(1)' }],
    documents: [{ title: 'My <b>CV</b>', url: 'https://example.com/cv.pdf' }],
  }));
  return { res, body: await res.json() as any };
}
async function fullyTracked() {
  const { body } = await registerSample();
  await handleInjected(deps, post(`/api/emails/${body.email_id}/injected`, alice, { pixel_injected: true, links_rewritten: 1 }), body.email_id);
  clock = new Date(clock.getTime() + 1000);
  await handleConfirmSent(deps, post(`/api/emails/${body.email_id}/confirm-sent`, alice, {}), body.email_id);
  clock = new Date(clock.getTime() + 60_000);
  return body;
}

describe('registration', () => {
  it('requires auth, validates input, rejects unsafe links and returns tokens once', async () => {
    expect((await handleRegister(deps, post('/api/emails', null, {}))).status).toBe(401);
    expect((await handleRegister(deps, post('/api/emails', alice, { recipients: ['not-an-email'] }))).status).toBe(400);
    const { res, body } = await registerSample();
    expect(res.status).toBe(201);
    expect(body.rejected).toEqual([{ url: 'javascript:alert(1)', reason: 'scheme_not_allowed' }]);
    expect(body.links).toHaveLength(1);                       // duplicate URL shares one tracked link
    expect(body.pixel_url).toMatch(/^https:\/\/track\.example\.com\/api\/t\/[\w-]{22}\.gif$/);
    const row = (await sys(db, 'select * from public.tracked_emails')).rows[0];
    expect(row).toMatchObject({ status: 'registered', recipients: ['bob@example.com'], pixel_injected: false });
    const dump = JSON.stringify((await sys(db, 'select * from public.tracked_links')).rows) + JSON.stringify(row);
    expect(dump).not.toContain(tokenOf(body.pixel_url));      // raw tokens are not stored
  });
  it('rate limits registration per user', async () => {
    let last = 201;
    for (let i = 0; i < 61; i++) last = (await handleRegister(deps, post('/api/emails', alice, { recipients: [] }))).status;
    expect(last).toBe(429);
  });
});

describe('honest tracking state machine', () => {
  it('cannot confirm a send that was never marked injected', async () => {
    const { body } = await registerSample();
    const r = await handleConfirmSent(deps, post(`/api/emails/${body.email_id}/confirm-sent`, alice, {}), body.email_id);
    expect(r.status).toBe(409);
    expect((await sys(db, 'select status from public.tracked_emails')).rows[0].status).toBe('registered');
  });
  it('rejects an injection report where nothing was injected, or more links than registered', async () => {
    const { body } = await registerSample();
    for (const b of [{ pixel_injected: false, links_rewritten: 0 }, { pixel_injected: false, links_rewritten: 5 }]) {
      expect((await handleInjected(deps, post(`/api/emails/${body.email_id}/injected`, alice, b), body.email_id)).status).toBe(409);
    }
  });
  it("one user cannot update or confirm another user's email", async () => {
    const { body } = await registerSample();
    expect((await handleInjected(deps, post(`/api/emails/${body.email_id}/injected`, bob, { pixel_injected: true, links_rewritten: 0 }), body.email_id)).status).toBe(409);
    expect((await handleConfirmSent(deps, post(`/api/emails/${body.email_id}/confirm-sent`, bob, {}), body.email_id)).status).toBe(409);
    expect((await handleConfirmSent(deps, post(`/api/emails/not-a-uuid/confirm-sent`, alice, {}), 'not-a-uuid')).status).toBe(404);
  });
  it('registered -> injected -> send_confirmed records one email_sent event, idempotently', async () => {
    const body = await fullyTracked();
    const again = await handleConfirmSent(deps, post(`/api/emails/${body.email_id}/confirm-sent`, alice, {}), body.email_id);
    expect(again.status).toBe(200);
    expect((await events('email_sent'))).toHaveLength(1);
    expect((await sys(db, 'select status, pixel_injected, links_rewritten from public.tracked_emails')).rows[0]).toEqual({ status: 'send_confirmed', pixel_injected: true, links_rewritten: 1 });
  });
});

describe('pixel', () => {
  it('always serves a GIF, never leaking token validity, with no-store headers', async () => {
    const a = await handlePixel(deps, req(BASE + '/x'), 'nope.gif');
    const b = await handlePixel(deps, req(BASE + '/x'), newTokenLike() + '.gif');
    for (const r of [a, b]) { expect(r.status).toBe(200); expect(r.headers.get('content-type')).toBe('image/gif'); expect(r.headers.get('cache-control')).toContain('no-store'); }
    expect(Buffer.from(await a.arrayBuffer()).subarray(0, 3).toString()).toBe('GIF');
  });
  it('records nothing before the send is confirmed (e.g. sender previewing the draft)', async () => {
    const { body } = await registerSample();
    await handlePixel(deps, req(BASE + '/x'), tokenOf(body.pixel_url) + '.gif');
    expect(await events('open_signal')).toHaveLength(0);
  });
  it('records open_signal as uncertain, deduplicates repeats, and labels proxies/bots', async () => {
    const body = await fullyTracked(); const f = tokenOf(body.pixel_url) + '.gif';
    await handlePixel(deps, req(BASE + '/x'), f);
    await handlePixel(deps, req(BASE + '/x'), f);                                    // duplicate within bucket
    expect(await events('open_signal')).toHaveLength(1);
    expect((await events('open_signal'))[0]).toMatchObject({ source: 'pixel', confidence: 'uncertain', ua_family: 'chrome' });
    await handlePixel(deps, req(BASE + '/x', { headers: { 'user-agent': 'GoogleImageProxy' }, ip: '66.249.1.1' }), f);
    await handlePixel(deps, req(BASE + '/x', { headers: { 'user-agent': 'Barracuda Sentinel' }, ip: '5.5.5.5' }), f);
    const rows = await events('open_signal');
    expect(rows.map((r: any) => r.ua_family).sort()).toEqual(['chrome', 'gmail_image_proxy', 'security_scanner']);
    expect(rows.find((r: any) => r.ua_family === 'security_scanner').confidence).toBe('likely_automated');
    expect(rows.every((r: any) => r.confidence !== 'likely_human')).toBe(true);
    expect(rows.every((r: any) => r.ip_hash?.length === 32)).toBe(true);            // hash only, 32 bytes
  });
  it('still serves the image but stops recording when an IP exceeds the rate limit', async () => {
    const body = await fullyTracked(); const f = tokenOf(body.pixel_url) + '.gif';
    let status = 0;
    for (let i = 0; i < 125; i++) { clock = new Date(clock.getTime() + 400_000 * 0); status = (await handlePixel(deps, req(BASE + '/x'), f)).status; }
    expect(status).toBe(200);
    expect((await events('open_signal')).length).toBeLessThanOrEqual(1);
  });
});

describe('tracked link redirect', () => {
  it('302s to the validated destination and records link_clicked with a label', async () => {
    const body = await fullyTracked(); const t = tokenOf(body.links[0].tracked_url);
    const r = await handleLink(deps, req(BASE + '/x'), t);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.com/portfolio');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const ev = (await events('link_clicked'));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: 'redirect', confidence: 'likely_human' });
    expect((await sys(db, 'select label from public.tracked_links')).rows[0].label).toBe('Portfolio');
    await handleLink(deps, req(BASE + '/x'), t);                                    // immediate repeat is deduped
    expect(await events('link_clicked')).toHaveLength(1);
  });
  it('labels scanner clicks as automated, and a click right after send as automated', async () => {
    const body = await fullyTracked(); const t = tokenOf(body.links[0].tracked_url);
    await handleLink(deps, req(BASE + '/x', { headers: { 'user-agent': 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)' }, ip: '9.9.9.9' }), t);
    expect((await events('link_clicked'))[0].confidence).toBe('likely_automated');
  });
  it('redirects but does not record before the send is confirmed', async () => {
    const { body } = await registerSample();
    const r = await handleLink(deps, req(BASE + '/x'), tokenOf(body.links[0].tracked_url));
    expect(r.status).toBe(302);
    expect(await events('link_clicked')).toHaveLength(0);
  });
  it('404s unknown or malformed tokens (no open redirect through parameters)', async () => {
    expect((await handleLink(deps, req(BASE + '/x?url=https://evil.com'), newTokenLike())).status).toBe(404);
    expect((await handleLink(deps, req(BASE + '/x'), '../../etc/passwd')).status).toBe(404);
  });
  it('refuses to redirect if a stored destination is no longer safe', async () => {
    const body = await fullyTracked();
    await sys(db, `update public.tracked_links set destination_url = 'http://127.0.0.1/admin'`);
    expect((await handleLink(deps, req(BASE + '/x'), tokenOf(body.links[0].tracked_url))).status).toBe(404);
  });
});

describe('document landing page', () => {
  it('records document_visit, escapes the title and sets restrictive headers', async () => {
    const body = await fullyTracked(); const t = tokenOf(body.documents[0].landing_url);
    const r = await handleDocument(deps, req(BASE + '/x'), t);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('My &lt;b&gt;CV&lt;/b&gt;'); expect(html).not.toContain('<b>CV</b>');
    expect(html).toContain('href="https://example.com/cv.pdf"');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
    const ev = await events('document_visit');
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ source: 'landing_page', confidence: 'likely_human' });
  });
  it('404s unknown tokens without recording', async () => {
    expect((await handleDocument(deps, req(BASE + '/x'), newTokenLike())).status).toBe(404);
    expect(await events()).toHaveLength(0);
  });
});

describe('cron, health, cors', () => {
  it('purge requires the cron secret', async () => {
    expect((await handlePurge(deps, req(BASE + '/x'))).status).toBe(401);
    expect((await handlePurge(deps, req(BASE + '/x', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    const ok = await handlePurge(deps, req(BASE + '/x', { headers: { authorization: 'Bearer ' + CRON } }));
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ purged: 0 });
  });
  it('health: shallow always ok; deep checks the database', async () => {
    expect((await handleHealth(deps, req(BASE + '/api/health'))).status).toBe(200);
    expect((await handleHealth(deps, req(BASE + '/api/health?deep=1'))).status).toBe(200);
    expect((await handleHealth(null, req(BASE + '/api/health?deep=1'))).status).toBe(503);
  });
  it('CORS only for allowed extension origins', () => {
    const ok = handleOptions(deps, req(BASE + '/x', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abc' } }));
    const bad = handleOptions(deps, req(BASE + '/x', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } }));
    expect(ok.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc');
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

function newTokenLike() { return 'A'.repeat(22); }
