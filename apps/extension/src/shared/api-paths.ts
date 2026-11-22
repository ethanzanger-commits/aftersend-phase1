/** The only server paths the Gmail page may ask the background worker to call. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE = [new RegExp('^/api/emails$'), new RegExp(`^/api/emails/${UUID}/injected$`, 'i'), new RegExp(`^/api/emails/${UUID}/confirm-sent$`, 'i')];
export const isAllowedApiPath = (p: unknown): p is string => typeof p === 'string' && RE.some((r) => r.test(p));
