import { route } from '@/route';
import { handlePixel } from '@/handlers';
export const dynamic = 'force-dynamic';
export const GET = route((d, req, p) => handlePixel(d, req, p.file));
