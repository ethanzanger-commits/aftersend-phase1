export type Config = { baseUrl: string; ipSalt: string; cronSecret: string; allowedOrigins: string[] };

/** Reads server env vars. Throws a clear error (never printing secret values) if misconfigured. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v || v.startsWith('replace-me')) throw new Error(`Missing or placeholder env var: ${k}`);
    return v;
  };
  const baseUrl = need('TRACKING_BASE_URL').replace(/\/+$/, '');
  const u = new URL(baseUrl);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('TRACKING_BASE_URL must be https');
  const ipSalt = need('IP_HASH_SALT');
  const cronSecret = need('CRON_SECRET');
  if (ipSalt.length < 32) throw new Error('IP_HASH_SALT must be at least 32 characters');
  if (cronSecret.length < 32) throw new Error('CRON_SECRET must be at least 32 characters');
  const allowedOrigins = (env.ALLOWED_EXTENSION_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('chrome-extension://'));
  return { baseUrl, ipSalt, cronSecret, allowedOrigins };
}
