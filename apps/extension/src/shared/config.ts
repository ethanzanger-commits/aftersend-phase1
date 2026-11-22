import { API_BASE } from './api-base';
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
/** Build-time values. Only the PUBLISHABLE (anon) key is ever allowed here; build.mjs refuses secret/service-role keys. */
export const CONFIG = { supabaseUrl: __SUPABASE_URL__, anonKey: __SUPABASE_ANON_KEY__, apiBase: API_BASE };
