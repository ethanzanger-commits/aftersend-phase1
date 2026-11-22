import { getDeps, type Deps } from './deps';

type Ctx = { params: Promise<Record<string, string>> };
/** Wraps a handler: builds deps lazily, resolves params, never leaks error details. */
export function route(h: (d: Deps, req: Request, params: Record<string, string>) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try { return await h(getDeps(), req, ctx?.params ? await ctx.params : {}); }
    catch (e) {
      console.error('handler_error', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
      return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
  };
}
