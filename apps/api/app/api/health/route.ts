import { handleHealth } from '@/handlers';
import { getDeps } from '@/deps';
export const dynamic = 'force-dynamic';
export const GET = async (req: Request) => {
  let d = null; try { d = getDeps(); } catch { /* reported as misconfigured on deep check */ }
  return handleHealth(d, req);
};
