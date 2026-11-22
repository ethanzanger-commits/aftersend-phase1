import { route } from '@/route';
import { handleConfirmSent, handleOptions } from '@/handlers';
export const dynamic = 'force-dynamic';
export const POST = route((d, req, p) => handleConfirmSent(d, req, p.id));
export const OPTIONS = route(async (d, req) => handleOptions(d, req));
