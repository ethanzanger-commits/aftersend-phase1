export type Ev = { id: string; email_id: string; event_type: string; confidence: string; link_id: string | null; document_id: string | null; created_at: string };
export type Names = { emails: Record<string, { subject: string | null; recipients: string[] }>; links: Record<string, string>; docs: Record<string, string> };
export type Prefs = { first_link_click: boolean; document_visit: boolean };
export type Planned = { key: string; title: string; message: string };

const who = (n: Names, id: string) => { const e = n.emails[id]; return `${e?.subject || '(no subject)'}${e?.recipients?.[0] ? ' to ' + e.recipients[0] : ''}`; };

/** Pure decision logic: one notification per email's first link click and per document's first visit.
 *  Opens never notify; likely_automated activity never notifies; uncertain activity is flagged as such. */
export function planNotifications(events: Ev[], names: Names, notified: string[], prefs: Prefs): Planned[] {
  const done = new Set(notified); const out: Planned[] = [];
  for (const e of events) {
    if (e.confidence === 'likely_automated') continue;
    const flag = e.confidence === 'uncertain' ? ' (could be automated)' : '';
    let p: Planned | null = null;
    if (e.event_type === 'link_clicked' && prefs.first_link_click)
      p = { key: `click:${e.email_id}`, title: `Link clicked${flag}`, message: `${names.links[e.link_id ?? ''] ?? 'A link'} in "${who(names, e.email_id)}"` };
    if (e.event_type === 'document_visit' && prefs.document_visit)
      p = { key: `doc:${e.document_id}`, title: `Document page visited${flag}`, message: `${names.docs[e.document_id ?? ''] ?? 'A document'} from "${who(names, e.email_id)}"` };
    if (p && !done.has(p.key)) { done.add(p.key); out.push(p); }
  }
  return out;
}

export const followUpMessage = (subject: string | null, to: string | undefined) =>
  `"${subject || '(no subject)'}"${to ? ' to ' + to : ''}: time to consider a follow-up. AfterSend cannot detect replies, so check your inbox first.`;
