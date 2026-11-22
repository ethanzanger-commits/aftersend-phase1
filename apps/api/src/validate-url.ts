export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** Safe-redirect validation: only absolute http(s) URLs to public hosts, no credentials. */
export function validateDestination(raw: unknown, opts: { blockedHosts?: string[] } = {}): UrlCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_string' };
  const s = raw.trim();
  if (s.length === 0) return { ok: false, reason: 'empty' };
  if (s.length > 2048) return { ok: false, reason: 'too_long' };
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return { ok: false, reason: 'control_or_whitespace' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme_not_allowed' };
  if (u.username || u.password) return { ok: false, reason: 'credentials_not_allowed' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !host.includes(':')) return { ok: false, reason: 'host_not_public' };
  if (host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host)) return { ok: false, reason: 'host_not_public' };
  if (PRIVATE_V4.test(host)) return { ok: false, reason: 'host_not_public' };
  if (host.includes(':') && (host === '::1' || host === '::' || /^(fc|fd|fe[89ab])/.test(host))) return { ok: false, reason: 'host_not_public' };
  if (opts.blockedHosts?.some((h) => h.toLowerCase() === host)) return { ok: false, reason: 'self_redirect' };
  return { ok: true, url: u.href };
}
