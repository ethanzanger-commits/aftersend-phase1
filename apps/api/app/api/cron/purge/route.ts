import { route } from '@/route';
import { handlePurge } from '@/handlers';
export const dynamic = 'force-dynamic';
export const GET = route((d, req) => handlePurge(d, req));
