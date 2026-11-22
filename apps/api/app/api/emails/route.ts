import { route } from '@/route';
import { handleRegister, handleOptions } from '@/handlers';
export const dynamic = 'force-dynamic';
export const POST = route((d, req) => handleRegister(d, req));
export const OPTIONS = route(async (d, req) => handleOptions(d, req));
