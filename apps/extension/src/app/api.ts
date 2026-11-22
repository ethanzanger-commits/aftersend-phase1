import { makeClient } from '../shared/supabase';
import type { Email, Event, Names } from './labels';

export const sb = makeClient(true);
export type Settings = { retention_days: number; default_include_pixel: boolean; default_rewrite_links: boolean; notifications_enabled: boolean;
  notify_first_link_click: boolean; notify_document_visit: boolean; notify_reply: boolean; followup_reminder_days: number | null };

export async function loadAll(): Promise<{ emails: Email[]; events: Event[]; names: Names }> {
  const e = await sb.from('tracked_emails').select('id,recipients,subject,status,pixel_injected,links_rewritten,created_at,send_confirmed_at,last_activity_at,followup_due_at').order('created_at', { ascending: false }).limit(200);
  if (e.error) throw new Error(e.error.message);
  const emails = (e.data ?? []) as Email[]; const ids = emails.map((m) => m.id);
  if (!ids.length) return { emails, events: [], names: { links: {}, docs: {} } };
  const [ev, ln, dc] = await Promise.all([
    sb.from('email_events').select('id,email_id,event_type,source,confidence,confidence_reason,occurred_at,link_id,document_id').in('email_id', ids).order('occurred_at', { ascending: false }).limit(2000),
    sb.from('tracked_links').select('id,label,destination_url').in('email_id', ids),
    sb.from('tracked_documents').select('id,title').in('email_id', ids),
  ]);
  if (ev.error) throw new Error(ev.error.message);
  return { emails, events: (ev.data ?? []) as Event[],
    names: { links: Object.fromEntries((ln.data ?? []).map((l: any) => [l.id, { label: l.label, url: l.destination_url }])), docs: Object.fromEntries((dc.data ?? []).map((d: any) => [d.id, d.title])) } };
}
export async function getSettings(): Promise<Settings | null> { return ((await sb.from('user_settings').select('*').maybeSingle()).data as Settings | null); }
export async function saveSettings(patch: Partial<Settings>) { const { data: u } = await sb.auth.getUser(); const r = await sb.from('user_settings').update(patch).eq('user_id', u.user!.id); if (r.error) throw new Error(r.error.message); }
export async function deleteAllData(): Promise<number> { const r = await sb.rpc('delete_my_tracking_data'); if (r.error) throw new Error(r.error.message); return r.data as number; }

export type Doc = { title: string; url: string };
export const getDocs = async (): Promise<Doc[]> => ((await chrome.storage.local.get('aftersend_documents')).aftersend_documents as Doc[]) ?? [];
export const setDocs = (d: Doc[]) => chrome.storage.local.set({ aftersend_documents: d });
