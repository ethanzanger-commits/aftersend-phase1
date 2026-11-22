import type { Data } from './App';
import { statusLabel, eventTitle, confidenceLabel, fmt } from './labels';

export function Detail({ data, id }: { data: Data; id: string }) {
  const m = data.emails.find((e) => e.id === id);
  if (!m) return <div className="card empty"><b>Email not found</b><p><a href="#/">Back to dashboard</a></p></div>;
  const s = statusLabel(m.status);
  const evs = data.events.filter((e) => e.email_id === id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const last = [...evs].reverse().find((e) => e.event_type !== 'email_sent');
  return (<>
    <p><a href="#/">&larr; Dashboard</a></p>
    <div className="card"><h1>{m.subject || '(no subject)'}</h1>
      <p className="muted">To {m.recipients.join(', ') || 'unknown'}</p>
      <p><span className={`badge ${s.tone}`}>{s.text}</span> <span className="muted small">Sent {fmt(m.send_confirmed_at)} · pixel {m.pixel_injected ? 'added' : 'not added'} · {m.links_rewritten} link(s) tracked</span></p>
      <p><b>Most recent observed activity:</b> {last ? `${eventTitle(last, data.names)} (${fmt(last.occurred_at)})` : 'None observed'}</p>
      {m.status !== 'send_confirmed' && <p className="notice warn">This email is not confirmed as sent through AfterSend, so no activity is recorded for it.</p>}</div>
    <h2>Timeline</h2>
    {evs.length === 0 ? <p className="muted">Nothing recorded yet.</p> : <ol className="timeline">{evs.map((e) => (
      <li key={e.id}><span className="dot" /><div><b>{eventTitle(e, data.names)}</b>
        <div className="muted small">{fmt(e.occurred_at)} · source: {e.source} · {e.event_type === 'email_sent' ? 'recorded by the extension' : confidenceLabel(e.confidence)}{e.confidence_reason ? ` (${e.confidence_reason.replace(/_/g, ' ')})` : ''}</div></div></li>))}</ol>}
    <div className="card small muted"><b>Not detected in this version:</b> replies, bounces, forwards, and whether an attached PDF was opened.</div>
  </>);
}
