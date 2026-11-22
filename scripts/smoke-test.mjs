// AfterSend end-to-end smoke test against YOUR real Supabase project.
// Creates two throwaway test users, walks the whole tracking flow, checks privacy rules, then deletes the test users
// (which also deletes all test data). Prints PASS/FAIL per check. Never prints keys or tokens.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = process.env.AFTERSEND_ENV_FILE ?? join(root, 'apps', 'api', '.env.local');

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const bad = (name, why) => { failures++; console.log(`  FAIL  ${name}${why ? ' -> ' + why : ''}`); };
const check = (cond, name, why) => (cond ? ok(name) : bad(name, why));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv(path) {
  if (!existsSync(path)) throw new Error(`Settings file not found: ${path}`);
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function askHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return reject_(resolve);
    process.stdout.write(question);
    let buf = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData);
          process.stdout.write('\n'); return resolve(buf.trim());
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    process.stdin.on('data', onData);
  });
}
const reject_ = (resolve) => resolve('');

async function http(url, init = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), ...init });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}

let server = null;
function stopServer() {
  if (!server) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch { /* already gone */ }
  server = null;
}

async function main() {
  console.log('\nAfterSend smoke test\n');
  const env = loadEnv(envFile);
  const SB = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const SECRET = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const BASE = (env.TRACKING_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB) && !process.env.AFTERSEND_ALLOW_ANY_SUPABASE_URL) {
    throw new Error('SUPABASE_URL in your settings file should look like https://<project-id>.supabase.co');
  }
  if (!SECRET) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing from your settings file');

  let PUB = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!PUB) PUB = await askHidden('Paste your Supabase PUBLISHABLE key (starts with sb_publishable_), then press Enter: ');
  if (PUB.startsWith('sb_secret_')) throw new Error('That is the SECRET key. Use the PUBLISHABLE key here.');
  if (!PUB) throw new Error('No publishable key provided');

  // --- 1. server ---
  let reuse = false;
  try { reuse = (await http(`${BASE}/api/health`)).status === 200; } catch { /* not running */ }
  if (!reuse && !process.env.AFTERSEND_NO_SPAWN) {
    console.log('Starting the tracking server (first start can take about 30 seconds)...');
    server = spawn('npm run dev -w @aftersend/api', { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; const keep = (d) => { log = (log + d).slice(-3000); };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    server.on('exit', () => { if (server) console.log('  (server stopped unexpectedly)\n' + log.split('\n').slice(-12).join('\n')); });
  }
  let healthy = false;
  for (let i = 0; i < 60 && !healthy; i++) {
    try { const h = await http(`${BASE}/api/health?deep=1`); healthy = h.status === 200 && h.json?.status === 'ok'; if (!healthy && h.json?.status) { if (i > 3) break; } } catch { /* wait */ }
    if (!healthy) await sleep(1500);
  }
  check(healthy, 'Server is up and connected to your database', 'health?deep=1 did not return ok');
  if (!healthy) return;

  // --- helpers for Supabase admin / auth ---
  const adm = (path, init = {}) => http(`${SB}/auth/v1${path}`, { ...init, headers: { apikey: SECRET, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const created = [];
  const makeUser = async (label) => {
    const email = `aftersend-smoke-${label}-${Date.now()}@example.com`;
    const password = randomBytes(12).toString('hex') + 'Aa1!';
    const r = await adm('/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
    if (r.status >= 300 || !r.json?.id) throw new Error(`Could not create test user (HTTP ${r.status}). Is the SECRET key correct?`);
    created.push(r.json.id);
    const t = await http(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUB, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (t.status !== 200 || !t.json?.access_token) throw new Error(`Test user could not sign in (HTTP ${t.status}). Is the PUBLISHABLE key correct?`);
    return { id: r.json.id, jwt: t.json.access_token };
  };
  const rest = (jwt, path, init = {}) => http(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: PUB, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const api = (jwt, path, body) => http(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const A = await makeUser('a'); const B = await makeUser('b');
    ok('Created two throwaway test users and signed them in');

    // --- 2. security basics ---
    check((await http(`${BASE}/api/emails`, { method: 'POST', body: '{}' })).status === 401, 'Registration without login is refused (401)');

    // --- 3. register ---
    const reg = await api(A.jwt, '/api/emails', {
      recipients: ['friend@example.com'], subject: 'Smoke test',
      links: [{ url: 'https://example.com/portfolio', label: 'Portfolio' }, { url: 'javascript:alert(1)' }],
      documents: [{ title: 'Smoke CV', url: 'https://example.com/cv.pdf' }],
    });
    check(reg.status === 201 && reg.json?.email_id, 'Email registered with the real database', `HTTP ${reg.status}`);
    if (reg.status !== 201) return;
    const { email_id, pixel_url, links, documents, rejected } = reg.json;
    check(rejected?.some((r) => r.reason === 'scheme_not_allowed'), 'Unsafe javascript: link was rejected');
    check(links?.length === 1 && documents?.length === 1, 'One tracked link and one document link were created');

    // --- 4. honesty: cannot be "tracked" until injected + confirmed ---
    const reg2 = await api(A.jwt, '/api/emails', { recipients: [], subject: 'Never injected' });
    const early = await api(A.jwt, `/api/emails/${reg2.json.email_id}/confirm-sent`, {});
    check(early.status === 409, 'Cannot confirm a send that was never marked as injected (409)');
    await http(pixel_url, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/126 Safari/537.36' } });   // sender previews draft
    const inj = await api(A.jwt, `/api/emails/${email_id}/injected`, { pixel_injected: true, links_rewritten: 1 });
    check(inj.status === 200, 'Injection recorded');
    const conf = await api(A.jwt, `/api/emails/${email_id}/confirm-sent`, {});
    check(conf.status === 200 && conf.json?.status === 'send_confirmed', 'Send confirmed');

    // --- 5. recipient actions ---
    const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' };
    const px = await http(pixel_url, { headers: UA }); await http(pixel_url, { headers: UA });
    check(px.status === 200 && (px.headers.get('content-type') ?? '').includes('image/gif'), 'Pixel serves a GIF');
    const lk = await http(links[0].tracked_url, { redirect: 'manual', headers: UA });
    check(lk.status === 302 && lk.headers.get('location') === 'https://example.com/portfolio', 'Tracked link redirects to the right place (302)');
    const dc = await http(documents[0].landing_url, { headers: UA });
    check(dc.status === 200 && dc.text.includes('Smoke CV'), 'Document landing page loads');
    check((await http(`${BASE}/api/l/AAAAAAAAAAAAAAAAAAAAAA`, { redirect: 'manual' })).status === 404, 'Unknown link token gives 404');

    // --- 6. read events back as the user (this also exercises Row Level Security) ---
    const ev = await rest(A.jwt, `email_events?select=event_type,source,confidence,confidence_reason&email_id=eq.${email_id}&order=created_at`);
    const types = (ev.json ?? []).map((e) => e.event_type);
    check(ev.status === 200 && ['email_sent', 'open_signal', 'link_clicked', 'document_visit'].every((t) => types.includes(t)),
      'Timeline contains email_sent, open_signal, link_clicked, document_visit', `got: ${types.join(', ') || 'nothing'} (HTTP ${ev.status})`);
    check(types.filter((t) => t === 'open_signal').length === 1, 'Draft preview was ignored and repeated opens were de-duplicated (exactly 1 open_signal)', `found ${types.filter((t) => t === 'open_signal').length}`);
    check((ev.json ?? []).filter((e) => e.event_type === 'open_signal').every((e) => e.confidence !== 'likely_human'), 'Opens are never labelled likely_human');
    for (const e of ev.json ?? []) console.log(`        ${e.event_type.padEnd(15)} source=${e.source.padEnd(12)} label=${e.confidence} (${e.confidence_reason ?? '-'})`);

    // --- 7. privacy: Row Level Security ---
    const bEmails = await rest(B.jwt, 'tracked_emails?select=id'); const bEvents = await rest(B.jwt, 'email_events?select=id');
    check(bEmails.status === 200 && bEmails.json?.length === 0 && bEvents.json?.length === 0, 'Another user cannot see your emails or events');
    const aEmails = await rest(A.jwt, 'tracked_emails?select=id,status,recipients,subject');
    check(aEmails.json?.some((e) => e.id === email_id && e.status === 'send_confirmed'), 'You can see your own email as send_confirmed');
    const forge = await rest(A.jwt, 'email_events', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ user_id: A.id, email_id, event_type: 'link_clicked', source: 'redirect', dedupe_key: 'forged' }) });
    check([401, 403].includes(forge.status), 'Users cannot write events directly (forging blocked)', `HTTP ${forge.status}`);
    const forge2 = await rest(A.jwt, 'tracked_emails', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ user_id: A.id, pixel_token_hash: '\\x' + '00'.repeat(32) }) });
    check([401, 403].includes(forge2.status), 'Users cannot create tracking rows directly', `HTTP ${forge2.status}`);
  } finally {
    for (const id of created) await adm(`/admin/users/${id}`, { method: 'DELETE' }).catch(() => {});
    if (created.length) console.log(`  Deleted ${created.length} test users (and all their test data)`);
  }
}

try { await main(); } catch (e) { failures++; console.log(`\n  ERROR: ${e.message}`); }
stopServer();
console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} PROBLEM(S) FOUND. Copy everything above (it contains no keys) and send it to Claude.\n`);
process.exit(failures === 0 ? 0 : 1);
