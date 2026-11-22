import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(__dirname, '..'); const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [join(dir, 'build.mjs'), ...args], { env: { ...process.env, EXT_SUPABASE_URL: '', EXT_SUPABASE_ANON_KEY: '', EXT_API_BASE_URL: '', ...env }, encoding: 'utf8' });

describe('extension build', () => {
  const out = mkdtempSync(join(tmpdir(), 'ext-'));
  it('produces a minimal-permission MV3 manifest and all files', () => {
    const r = run(['--out', out, '--test-config']); expect(r.status).toBe(0);
    const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions.sort()).toEqual(['alarms', 'notifications', 'storage']);
    expect(m.host_permissions).toEqual(['https://mail.google.com/*', 'https://track.example.com/*', 'https://testproject.supabase.co/*']);
    expect(m.content_scripts[0].matches).toEqual(['https://mail.google.com/*']);
    for (const f of ['background.js', 'content.js', 'app.js', 'app.css', 'app.html', 'icon48.png']) expect(existsSync(join(out, f))).toBe(true);
    expect(readFileSync(join(out, 'icon48.png')).subarray(1, 4).toString()).toBe('PNG');
  });
  it('never contains service-role or secret-key material, and the Gmail script has no Supabase client', () => {
    for (const f of readdirSync(out).filter((x) => x.endsWith('.js'))) {
      const t = readFileSync(join(out, f), 'utf8');
      expect(t).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}|SUPABASE_SERVICE_ROLE_KEY/);
    }
    expect(readFileSync(join(out, 'content.js'), 'utf8')).not.toContain('supabase');
  });
  it('refuses secret keys, service-role JWTs and non-https Supabase URLs', () => {
    const base = { EXT_SUPABASE_URL: 'https://abc123.supabase.co', EXT_API_BASE_URL: 'http://localhost:3000' };
    const bad = (key: string, extra: Record<string, string> = {}) => run(['--out', out], { ...base, EXT_SUPABASE_ANON_KEY: key, ...extra });
    expect(bad('sb_secret_abcdef').stderr).toMatch(/SECRET key/);
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
    expect(bad(jwt('service_role')).stderr).toMatch(/role "service_role"/);
    expect(bad('sb_publishable_ok', { EXT_SUPABASE_URL: 'http://abc.supabase.co' }).stderr).toMatch(/EXT_SUPABASE_URL/);
    expect(bad('sb_publishable_ok').status).toBe(0);
    expect(bad(jwt('anon')).status).toBe(0);
  });
});
