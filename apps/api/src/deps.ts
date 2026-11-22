import { createClient } from '@supabase/supabase-js';
import { loadConfig, type Config } from './config';
import { createRpcStore, type Store } from './store';
import { createMemoryLimiter, type Limiter } from './rate-limit';

export type Deps = {
  config: Config; store: Store; limiter: Limiter; now: () => Date;
  /** Returns the authenticated user's id from the request's Bearer JWT, or null. */
  authenticate: (req: Request) => Promise<string | null>;
};

let cached: Deps | null = null;

/** Builds real dependencies from env. The service-role key is read here and nowhere else. */
export function getDeps(): Deps {
  if (cached) return cached;
  const config = loadConfig();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('replace-me')) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = createRpcStore(async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`rpc ${fn} failed: ${error.code ?? 'error'}`);
    return data;
  });
  cached = {
    config, store, limiter: createMemoryLimiter(), now: () => new Date(),
    async authenticate(req) {
      const m = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.get('authorization') ?? '');
      if (!m) return null;
      const { data, error } = await sb.auth.getUser(m[1]);
      return error || !data.user ? null : data.user.id;
    },
  };
  return cached;
}
