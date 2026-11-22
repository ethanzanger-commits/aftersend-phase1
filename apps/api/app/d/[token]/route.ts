import { route } from '@/route';
import { handleDocument } from '@/handlers';
export const dynamic = 'force-dynamic';
export const GET = route((d, req, p) => handleDocument(d, req, p.token));
