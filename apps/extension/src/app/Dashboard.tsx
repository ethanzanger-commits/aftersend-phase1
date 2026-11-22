import { useMemo, useState } from 'react';
import type { Data } from './App';
import { statusLabel, filterEmails, fmt, eventTitle, confidenceLabel, type Filters } from './labels';

export function Dashboard({ data }: { data: Data }) {
  const [f, setF] = useState<Filters>({ q: '', days: null, activity: 'any' });
  const { emails, events, names } = data;
  const shown = useMemo(() => filterEmails(emails, events, f), [emails, events, f]);
  const last = useMemo(() => { const m = new Map<string, string>(); for (const e of events) if (e.event_type !== 'email_sent' && !m.has(e.email_id)) m.set(e.email_id, e.occurred_at); return m; }, [events]);
  const count = (t: string) => new Set(events.filter((e) => e.event_type === t).map((e) => e.email_id)).size;
  const sent = emails.filter((e) => e.status === 'send_confirmed').length;
  const recent = events.filter((e) => e.event_type !== 'email_sent').slice(0, 8);
  const subj = (id: string) => emails.find((m) => m.id === id)?.subject || '(no subject)';

  return (<>
    <section className="stats">
      <div className="card"><b>{sent}</b><span>Tracked and sent</span></div>
      <div className="card"><b>{count('link_clicked')}</b><span>Emails with link clicks</span></div>
      <div className="card"><b>{count('document_visit')}</b><span>Emails with document visits</span></div>
      <div className="card"><b>{count('open_signal')}</b><span>Emails with open signals*</span></div>
    </section>
    <p className="muted small">*Open signals are imperfect: image proxies, prefetching and your own views can trigger them. Replies, bounces and forwards are not detected in this version.</p>
    <div className="filters">
      <input placeholder="Search recipient or subject" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      <select value={f.days ?? ''} onChange={(e) => setF({ ...f, days: e.target.value ? Number(e.target.value) : null })}><option value="">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value as Filters['activity'] })}>
        <option value="any">Any activity</option><option value="link_clicked">Link clicked</option><option value="document_visit">Document visited</option><option value="open_signal">Open signal</option><option value="none">No activity yet</option></select>
    </div>
    {emails.length === 0 ? <div className="card empty"><b>No tracked emails yet</b><p className="muted">In Gmail, open a compose window, switch on "Track this email", and send. Your emails will appear here.</p></div>
    : shown.length === 0 ? <div className="card empty"><b>No emails match these filters</b></div>
    : <div className="list">{shown.map((m) => { const s = statusLabel(m.status); return (
      <a key={m.id} className="card row-item" href={`#/email/${m.id}`}>
        <div><b>{m.subject || '(no subject)'}</b><div className="muted small">To {m.recipients.join(', ') || 'unknown'} · {fmt(m.send_confirmed_at ?? m.created_at)}</div></div>
        <div className="right"><span className={`badge ${s.tone}`}>{s.text}</span><div className="muted small">Last activity: {fmt(last.get(m.id) ?? null)}</div></div></a>); })}</div>}
    <h2>Recent activity</h2>
    {recent.length === 0 ? <p className="muted">No activity observed yet.</p> : <ul className="plain">{recent.map((e) => (
      <li key={e.id}><a href={`#/email/${e.email_id}`}>{subj(e.email_id)}</a>: {eventTitle(e, names)} <span className="muted small">· {confidenceLabel(e.confidence)} · {fmt(e.occurred_at)}</span></li>))}</ul>}
    <h2>Replies</h2><p className="muted">Reply detection is not available in this version.</p>
  </>);
}
