export type Email = { id: string; recipients: string[]; subject: string | null; status: string; pixel_injected: boolean; links_rewritten: number;
  created_at: string; send_confirmed_at: string | null; last_activity_at: string | null; followup_due_at: string | null };
export type Event = { id: string; email_id: string; event_type: string; source: string; confidence: string; confidence_reason: string | null;
  occurred_at: string; link_id: string | null; document_id: string | null };

/** Only send_confirmed is ever shown as tracked. */
export function statusLabel(s: string): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (s === 'send_confirmed') return { text: 'Tracked and sent', tone: 'ok' };
  if (s === 'injected') return { text: 'Tracking added, send not confirmed', tone: 'warn' };
  if (s === 'registered') return { text: 'Not tracked (setup never completed)', tone: 'bad' };
  return { text: 'Failed', tone: 'bad' };
}
export function confidenceLabel(c: string): string {
  return c === 'likely_human' ? 'Likely a person (not confirmed)' : c === 'likely_automated' ? 'Likely automated' : 'Uncertain';
}
export type Names = { links: Record<string, { label: string | null; url: string }>; docs: Record<string, string> };
export function eventTitle(e: Event, n: Names): string {
  switch (e.event_type) {
    case 'email_sent': return 'Sent (confirmed from Gmail)';
    case 'open_signal': return 'Open signal (imperfect: may be an image proxy, prefetch or your own view)';
    case 'link_clicked': { const l = n.links[e.link_id ?? '']; return `Link clicked: ${l?.label || hostOf(l?.url) || 'link'}${l?.url ? ' (' + hostOf(l.url) + ')' : ''}`; }
    case 'document_visit': return `Document page visited: ${n.docs[e.document_id ?? ''] ?? 'document'}`;
    default: return e.event_type;
  }
}
export const hostOf = (u?: string) => { try { return u ? new URL(u).hostname : ''; } catch { return ''; } };

export type Filters = { q: string; days: number | null; activity: 'any' | 'link_clicked' | 'document_visit' | 'open_signal' | 'none' };
export function filterEmails(emails: Email[], events: Event[], f: Filters, now = Date.now()): Email[] {
  const q = f.q.trim().toLowerCase();
  const byEmail = new Map<string, Set<string>>();
  for (const e of events) { if (e.event_type === 'email_sent') continue; (byEmail.get(e.email_id) ?? byEmail.set(e.email_id, new Set()).get(e.email_id)!).add(e.event_type); }
  return emails.filter((m) => {
    if (q && !(m.subject ?? '').toLowerCase().includes(q) && !m.recipients.some((r) => r.includes(q))) return false;
    if (f.days !== null && now - new Date(m.send_confirmed_at ?? m.created_at).getTime() > f.days * 86400000) return false;
    const t = byEmail.get(m.id);
    if (f.activity === 'none') return !t;
    if (f.activity !== 'any') return !!t?.has(f.activity);
    return true;
  });
}
export const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'None observed');
