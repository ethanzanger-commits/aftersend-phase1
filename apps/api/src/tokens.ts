import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** 16 random bytes = 128 bits, base64url, 22 chars. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const newToken = () => randomBytes(16).toString('base64url');
/** Only this hash is stored; the raw token exists only in the URLs we hand out. */
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Salted, daily-rotating IP hash. The raw IP is never stored or logged. */
export function hashIp(ip: string, salt: string, now: Date = new Date()): string {
  return createHmac('sha256', `${salt}:${now.toISOString().slice(0, 10)}`).update(ip).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const A = createHash('sha256').update(a).digest();
  const B = createHash('sha256').update(b).digest();
  return timingSafeEqual(A, B);
}
