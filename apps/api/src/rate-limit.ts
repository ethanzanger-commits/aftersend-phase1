/** hit() returns true if allowed. */
export interface Limiter { hit(key: string, limit: number, windowMs: number): boolean }

/**
 * Best-effort fixed-window limiter held in process memory. On serverless each instance has its own counters,
 * so this blunts bursts but is NOT a global limit. Swap in a shared store (e.g. Upstash Redis) for hard limits.
 */
export function createMemoryLimiter(now: () => number = Date.now): Limiter {
  const m = new Map<string, { count: number; reset: number }>();
  return {
    hit(key, limit, windowMs) {
      const t = now();
      if (m.size > 10_000) for (const [k, v] of m) if (v.reset <= t) m.delete(k);
      const cur = m.get(key);
      if (!cur || cur.reset <= t) { m.set(key, { count: 1, reset: t + windowMs }); return true; }
      cur.count += 1;
      return cur.count <= limit;
    },
  };
}
