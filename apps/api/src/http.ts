import type { Deps } from './deps';

export const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function clientIp(req: Request): string {
  const xf = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
  return xf.split(',')[0]?.trim() || 'unknown';
}

export function corsHeaders(d: Deps, req: Request): Record<string, string> {
  const o = req.headers.get('origin');
  if (!o || !d.config.allowedOrigins.includes(o)) return {};
  return { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type',
           'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '600', vary: 'origin' };
}

export function json(d: Deps | null, req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(d ? corsHeaders(d, req) : {}) },
  });
}
