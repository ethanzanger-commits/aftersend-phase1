import { route } from '@/route';
import { handleLink } from '@/handlers';
export const dynamic = 'force-dynamic';
export const GET = route((d, req, p) => handleLink(d, req, p.token));
