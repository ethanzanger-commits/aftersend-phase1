import { makeClient } from './shared/supabase';
import { CONFIG } from './shared/config';
import { isAllowedApiPath } from './shared/api-paths';
import { planNotifications, followUpMessage, type Ev } from './notify-plan';

const sb = makeClient(false);   // no timers in a service worker; getSession() refreshes an expired token on demand
const GMAIL = 'https://mail.google.com/';
type Msg = { type?: string; path?: string; body?: unknown };

async function token(): Promise<string | null> { return (await sb.auth.getSession()).data.session?.access_token ?? null; }

async function handle(msg: Msg, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: 'forbidden' };
  if (!sender.url?.startsWith(GMAIL)) return { ok: false, error: 'forbidden' };   // only the Gmail content script may call these
  if (msg.type === 'auth') return { ok: true, signedIn: !!(await token()) };
  if (msg.type === 'defaults') {
    const { data } = await sb.from('user_settings').select('default_include_pixel,default_rewrite_links').maybeSingle();
    return { ok: true, data: data ?? { default_include_pixel: true, default_rewrite_links: true } };
  }
  if (msg.type === 'api') {
    if (!isAllowedApiPath(msg.path)) return { ok: false, error: 'forbidden_path' };
    const t = await token(); if (!t) return { ok: false, status: 401, error: 'unauthorized' };
    try {
      const res = await fetch(CONFIG.apiBase + msg.path, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(msg.body ?? {}) });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data: json, error: res.ok ? undefined : (json.error ?? `http_${res.status}`) };
    } catch { return { ok: false, error: 'network' }; }
  }
  return { ok: false, error: 'unknown_message' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'internal' }));
  return true;
});
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('poll', { periodInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') void poll(); });

// ---------------- optional notifications (polls YOUR events with YOUR session; RLS-scoped) ----------------
type Store = { lastPoll?: string; notified?: string[]; reminded?: string[] };
const KEY = 'aftersend_notify_state';
async function loadState(): Promise<Store> { return ((await chrome.storage.local.get(KEY))[KEY] as Store) ?? {}; }
const saveState = (s: Store) => chrome.storage.local.set({ [KEY]: { ...s, notified: (s.notified ?? []).slice(-500), reminded: (s.reminded ?? []).slice(-500) } });
const show = (id: string, title: string, message: string) =>
  chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icon48.png'), title: `AfterSend: ${title}`, message });

async function poll() {
  try {
    if (!(await token())) return;
    const { data: s } = await sb.from('user_settings').select('notifications_enabled,notify_first_link_click,notify_document_visit,followup_reminder_days').maybeSingle();
    if (!s?.notifications_enabled) return;
    const st = await loadState();
    const nowIso = new Date().toISOString();
    if (!st.lastPoll) { await saveState({ ...st, lastPoll: nowIso }); return; }   // first run: never flood with old events

    const { data: evs } = await sb.from('email_events').select('id,email_id,event_type,confidence,link_id,document_id,created_at')
      .gt('created_at', st.lastPoll).in('event_type', ['link_clicked', 'document_visit']).order('created_at').limit(100);
    const events = (evs ?? []) as Ev[]; const notified = st.notified ?? [];
    if (events.length) {
      const ids = [...new Set(events.map((e) => e.email_id))];
      const [em, ln, dc] = await Promise.all([
        sb.from('tracked_emails').select('id,subject,recipients').in('id', ids),
        sb.from('tracked_links').select('id,label').in('email_id', ids),
        sb.from('tracked_documents').select('id,title').in('email_id', ids),
      ]);
      const names = {
        emails: Object.fromEntries((em.data ?? []).map((e: any) => [e.id, { subject: e.subject, recipients: e.recipients }])),
        links: Object.fromEntries((ln.data ?? []).map((l: any) => [l.id, l.label ?? 'A link'])),
        docs: Object.fromEntries((dc.data ?? []).map((d: any) => [d.id, d.title])),
      };
      for (const p of planNotifications(events, names, notified, { first_link_click: !!s.notify_first_link_click, document_visit: !!s.notify_document_visit })) {
        show(p.key, p.title, p.message); notified.push(p.key);
      }
    }
    const reminded = st.reminded ?? [];
    if (s.followup_reminder_days) {
      const { data: due } = await sb.from('tracked_emails').select('id,subject,recipients').eq('status', 'send_confirmed')
        .not('followup_due_at', 'is', null).lte('followup_due_at', nowIso).limit(10);
      for (const e of (due ?? []) as any[]) if (!reminded.includes(e.id)) { show(`fu:${e.id}`, 'Follow-up reminder', followUpMessage(e.subject, e.recipients?.[0])); reminded.push(e.id); }
    }
    await saveState({ lastPoll: events.length ? events[events.length - 1].created_at : nowIso, notified, reminded });
  } catch { /* polling is best-effort */ }
}
