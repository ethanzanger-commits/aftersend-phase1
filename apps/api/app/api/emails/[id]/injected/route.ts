import { route } from '@/route';
import { handleInjected, handleOptions } from '@/handlers';
export const dynamic = 'force-dynamic';
export const POST = route((d, req, p) => handleInjected(d, req, p.id));
export const OPTIONS = route(async (d, req) => handleOptions(d, req));
