import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

const chromeStorage = {
  async getItem(k: string) { return ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null; },
  async setItem(k: string, v: string) { await chrome.storage.local.set({ [k]: v }); },
  async removeItem(k: string) { await chrome.storage.local.remove(k); },
};
/** Session lives in chrome.storage.local so the service worker and the app page share it. */
export const makeClient = (autoRefresh: boolean) =>
  createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { storage: chromeStorage, persistSession: true, autoRefreshToken: autoRefresh, detectSessionInUrl: false } });
