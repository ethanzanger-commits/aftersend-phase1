import { describe, it, expect } from 'vitest';
import { validateDestination } from '../src/validate-url';
import { classify, uaFamily } from '../src/classify';
import { newToken, hashToken, TOKEN_RE, hashIp } from '../src/tokens';
import { createMemoryLimiter } from '../src/rate-limit';
import { loadConfig } from '../src/config';

describe('validateDestination (safe redirects)', () => {
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com/x', '//evil.com',
    'https://user:pw@example.com/', 'http://localhost:3000/x', 'http://127.0.0.1/', 'http://2130706433/', 'http://10.0.0.5/',
    'http://192.168.1.1/', 'http://172.20.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://intranet/',
    'https://foo.internal/', 'https://exa mple.com', '', '   ', 'https://a.com/\nx'])('rejects %j', (u) => {
    expect(validateDestination(u).ok).toBe(false);
  });
  it('accepts normal public http(s) URLs and normalizes them', () => {
    expect(validateDestination('https://Example.com/a b'.replace(' ', '%20'))).toEqual({ ok: true, url: 'https://example.com/a%20b' });
    expect(validateDestination('http://example.org/?q=1#x').ok).toBe(true);
  });
  it('blocks redirecting back to the tracking host', () => {
    expect(validateDestination('https://track.example.com/api/l/x', { blockedHosts: ['track.example.com'] })).toMatchObject({ ok: false, reason: 'self_redirect' });
  });
  it('rejects non-strings', () => { expect(validateDestination(42).ok).toBe(false); });
});

describe('classify (bot / proxy uncertainty)', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  it('never labels opens as likely_human', () => {
    expect(classify('open_signal', chrome, 3600).confidence).toBe('uncertain');
    expect(classify('open_signal', 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)', 3600)).toMatchObject({ confidence: 'uncertain', uaFamily: 'gmail_image_proxy' });
  });
  it('labels scanners and bots as likely_automated', () => {
    for (const ua of ['Mozilla/4.0 (compatible; ms-office; MSOffice 16)', 'curl/8.0', 'Barracuda Sentinel', 'python-requests/2.31', 'Googlebot/2.1']) {
      expect(classify('link_clicked', ua, 3600).confidence).toBe('likely_automated');
    }
  });
  it('treats clicks right after send as automated and missing UA as uncertain', () => {
    expect(classify('link_clicked', chrome, 2)).toMatchObject({ confidence: 'likely_automated', reason: 'immediately_after_send' });
    expect(classify('document_visit', null, 900)).toMatchObject({ confidence: 'uncertain', reason: 'no_user_agent' });
  });
  it('labels ordinary browser clicks likely_human (not confirmed)', () => {
    expect(classify('link_clicked', chrome, 900).confidence).toBe('likely_human');
    expect(uaFamily(chrome)).toBe('chrome');
  });
});

describe('tokens', () => {
  it('are 128-bit, url-safe and unique; only hashes are derived', () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(TOKEN_RE); expect(a).not.toBe(b);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('IP hashes are salted and rotate daily', () => {
    const salt = 's'.repeat(32);
    const d1 = new Date('2026-10-28T10:00:00Z'), d2 = new Date('2026-10-29T10:00:00Z');
    expect(hashIp('1.2.3.4', salt, d1)).toBe(hashIp('1.2.3.4', salt, d1));
    expect(hashIp('1.2.3.4', salt, d1)).not.toBe(hashIp('1.2.3.4', salt, d2));
    expect(hashIp('1.2.3.4', salt, d1)).not.toBe(hashIp('1.2.3.5', salt, d1));
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window, then resets', () => {
    let t = 0; const l = createMemoryLimiter(() => t);
    expect([1, 2, 3, 4].map(() => l.hit('k', 3, 1000))).toEqual([true, true, true, false]);
    expect(l.hit('other', 3, 1000)).toBe(true);
    t = 1001; expect(l.hit('k', 3, 1000)).toBe(true);
  });
});

describe('config', () => {
  const good = { TRACKING_BASE_URL: 'https://t.example.com/', IP_HASH_SALT: 'a'.repeat(32), CRON_SECRET: 'b'.repeat(32), ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://abc, https://evil.com' };
  it('loads valid config and keeps only chrome-extension origins', () => {
    expect(loadConfig(good)).toMatchObject({ baseUrl: 'https://t.example.com', allowedOrigins: ['chrome-extension://abc'] });
  });
  it('rejects missing, placeholder, short or insecure values', () => {
    expect(() => loadConfig({ ...good, IP_HASH_SALT: undefined })).toThrow(/IP_HASH_SALT/);
    expect(() => loadConfig({ ...good, CRON_SECRET: 'replace-me' })).toThrow(/CRON_SECRET/);
    expect(() => loadConfig({ ...good, IP_HASH_SALT: 'short' })).toThrow(/32/);
    expect(() => loadConfig({ ...good, TRACKING_BASE_URL: 'http://t.example.com' })).toThrow(/https/);
  });
});
