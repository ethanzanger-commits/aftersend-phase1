// Runs scripts/smoke-test.mjs against: the REAL built API (next start, real supabase-js) talking to a MOCK of Supabase
// (auth + PostgREST shapes) that is backed by a real Postgres (PGlite) with our migrations and RLS roles.
// It validates our code paths and the script. It does NOT prove behaviour of real Supabase.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, as, sys } from '../db/helpers';

const root = join(__dirname, '..', '..');
const API_PORT = 3998;
let db: PGlite; let mock: http.Server; let mockPort = 0; let nextProc: ChildProcess;
const reqLog: string[] = [];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uidFrom = (req: http.IncomingMessage) => {
  const m = /^Bearer\s+\S+?\.(\S+?)\.\S+$/.exec(String(req.headers.authorization ?? ''));
  try { return m ? JSON.parse(Buffer.from(m[1], 'base64url').toString()).sub as string : null; } catch { return null; }
};
const readBody = (req: http.IncomingMessage) => new Promise<string>((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
const send = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, 'http://x'); const key = String(req.headers.apikey ?? '');
  reqLog.push(`${req.method} ${url.pathname}`);
  const body = await readBody(req);
  if (!key) return send(res, 401, { message: 'No API key found in request' });
  try {
    if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
      if (!key.startsWith('sb_secret_')) return send(res, 401, { msg: 'not admin' });
      const { email } = JSON.parse(body);
      const r = await sys(db, 'insert into auth.users (email) values ($1) returning id', [email]);
      return send(res, 200, { id: r.rows[0].id, email });
    }
    const del = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (del && req.method === 'DELETE') { await sys(db, 'delete from auth.users where id=$1', [del[1]]); return send(res, 200, {}); }
    if (url.pathname === '/auth/v1/token') {
      if (!key.startsWith('sb_publishable_')) return send(res, 401, { msg: 'bad key' });
      const { email } = JSON.parse(body);
      const r = await sys(db, 'select id from auth.users where email=$1', [email]);
      if (!r.rows[0]) return send(res, 400, { msg: 'Invalid login' });
      return send(res, 200, { access_token: `h.${b64({ sub: r.rows[0].id })}.s` });
    }
    if (url.pathname === '/auth/v1/user') { const u = uidFrom(req); return u ? send(res, 200, { id: u }) : send(res, 401, { msg: 'bad jwt' }); }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (rpc) {
      const args = JSON.parse(body || '{}'); const keys = Object.keys(args);
      const sql = `select * from public.${rpc[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      const rows = (await as(db, 'service_role', null, sql, keys.map((k) => args[k]))).rows;
      const scalar = rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === rpc[1];
      return send(res, 200, scalar ? rows[0][rpc[1]] : rows);
    }
    const tbl = /^\/rest\/v1\/(email_events|tracked_emails)$/.exec(url.pathname);
    if (tbl) {
      const uid = uidFrom(req); if (!uid) return send(res, 401, { message: 'JWT required' });
      try {
        if (req.method === 'GET') {
          const cols = (url.searchParams.get('select') ?? '*').split(',').map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c));
          const where: string[] = []; const params: unknown[] = [];
          for (const [k, v] of url.searchParams) if (/^[a-z_]+$/.test(k) && v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k} = $${params.length}`); }
          const order = /^[a-z_]+$/.test(url.searchParams.get('order') ?? '') ? ` order by ${url.searchParams.get('order')}` : '';
          const sql = `select ${cols.join(',')} from public.${tbl[1]}${where.length ? ' where ' + where.join(' and ') : ''}${order}`;
          return send(res, 200, (await as(db, 'authenticated', uid, sql, params)).rows);
        }
        const o = JSON.parse(body); const ks = Object.keys(o).filter((k) => /^[a-z_]+$/.test(k));
        await as(db, 'authenticated', uid, `insert into public.${tbl[1]} (${ks.join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')})`, ks.map((k) => (typeof o[k] === 'string' && o[k].startsWith('\\x') ? new Uint8Array(Buffer.from(o[k].slice(2), 'hex')) : o[k])));
        return send(res, 201, undefined);
      } catch (e: any) { return send(res, /permission denied/.test(e.message) ? 403 : 400, { code: '42501', message: e.message }); }
    }
    return send(res, 404, { message: 'mock: unknown route ' + url.pathname });
  } catch (e: any) { return send(res, 500, { message: 'mock error: ' + e.message }); }
}

beforeAll(async () => {
  db = await createDb();
  mock = http.createServer((q, s) => { handler(q, s); });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockPort = (mock.address() as any).port;
  nextProc = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(API_PORT)], {
    cwd: join(root, 'apps', 'api'), stdio: 'ignore',
    env: { ...process.env, TRACKING_BASE_URL: `http://localhost:${API_PORT}`, IP_HASH_SALT: 'a'.repeat(48), CRON_SECRET: 'b'.repeat(48),
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_mocktestkey', ALLOWED_EXTENSION_ORIGINS: '' },
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }
});
afterAll(() => { nextProc?.kill(); mock?.close(); });

describe('smoke-test.mjs against API + mock Supabase', () => {
  it('passes every check, leaves no data behind, and never prints keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-')); const envFile = join(dir, '.env.local');
    writeFileSync(envFile, `SUPABASE_URL=http://127.0.0.1:${mockPort}\r\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_mocktestkey\r\nTRACKING_BASE_URL=http://localhost:${API_PORT}\r\n`);
    const out = await new Promise<{ code: number; text: string }>((resolve) => {
      execFile(process.execPath, [join(root, 'scripts', 'smoke-test.mjs')], {
        env: { ...process.env, AFTERSEND_ENV_FILE: envFile, AFTERSEND_NO_SPAWN: '1', AFTERSEND_ALLOW_ANY_SUPABASE_URL: '1', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mocktest' },
        timeout: 120000,
      }, (err, stdout, stderr) => resolve({ code: err ? (err as any).code ?? 1 : 0, text: stdout + stderr }));
    });
    console.log(out.text);
    expect(out.text).toContain('ALL CHECKS PASSED');
    expect(out.code).toBe(0);
    expect(out.text).not.toMatch(/sb_secret_|sb_publishable_|eyJ/);
    expect((await sys(db, 'select count(*)::int as n from auth.users')).rows[0].n).toBe(0);
    expect((await sys(db, 'select count(*)::int as n from public.tracked_emails')).rows[0].n).toBe(0);
  });
});
