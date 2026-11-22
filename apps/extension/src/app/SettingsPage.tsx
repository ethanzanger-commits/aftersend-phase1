import { useEffect, useState } from 'react';
import { sb, getSettings, saveSettings, deleteAllData, getDocs, setDocs, type Settings, type Doc } from './api';

export function SettingsPage({ email, onChanged }: { email: string; onChanged: () => void }) {
  const [s, setS] = useState<Settings | null>(null); const [docs, setD] = useState<Doc[]>([]); const [msg, setMsg] = useState('');
  const [t, setT] = useState(''); const [u, setU] = useState('');
  useEffect(() => { getSettings().then(setS); getDocs().then(setD); }, []);
  const save = async (p: Partial<Settings>) => { if (!s) return; setS({ ...s, ...p }); try { await saveSettings(p); setMsg('Saved'); } catch (e: any) { setMsg('Could not save: ' + e.message); } };
  const addDoc = async () => {
    let ok = false; try { const x = new URL(u); ok = x.protocol === 'https:' || x.protocol === 'http:'; } catch { /* invalid */ }
    if (!t.trim() || !ok) return setMsg('Enter a title and a full http(s) URL.');
    const n = [...docs, { title: t.trim().slice(0, 200), url: u.trim() }]; await setDocs(n); setD(n); setT(''); setU(''); setMsg('Document added');
  };
  const wipe = async () => { if (!confirm('Delete ALL your tracked emails, links, documents and events? This cannot be undone.')) return;
    try { const n = await deleteAllData(); setMsg(`Deleted ${n} tracked email(s) and their events.`); onChanged(); } catch (e: any) { setMsg('Delete failed: ' + e.message); } };
  if (!s) return <p className="muted">Loading...</p>;
  const Chk = ({ k, label }: { k: keyof Settings; label: string }) => <label className="chk"><input type="checkbox" checked={!!s[k]} onChange={(e) => save({ [k]: e.target.checked } as Partial<Settings>)} /> {label}</label>;
  return (<>
    <div className="card"><h2>Account</h2><p>{email}</p><button className="ghost" onClick={() => sb.auth.signOut()}>Sign out</button></div>
    <div className="card"><h2>Tracking defaults</h2><p className="muted small">Tracking is always opt-in per email. These only set the starting options when you switch it on.</p>
      <Chk k="default_include_pixel" label="Add open-signal pixel (imperfect signal)" /><Chk k="default_rewrite_links" label="Track links" /></div>
    <div className="card"><h2>Tracked documents</h2><p className="muted small">Links to your CV or portfolio. Choose them per email from the Gmail toggle's options.</p>
      {docs.length === 0 ? <p className="muted">None yet.</p> : <ul className="plain">{docs.map((d, i) => <li key={i}>{d.title} <span className="muted small">{d.url}</span> <button className="link" onClick={async () => { const n = docs.filter((_, j) => j !== i); await setDocs(n); setD(n); }}>remove</button></li>)}</ul>}
      <div className="row"><input placeholder="Title (e.g. My CV)" value={t} onChange={(e) => setT(e.target.value)} /><input placeholder="https://..." value={u} onChange={(e) => setU(e.target.value)} /><button onClick={addDoc}>Add</button></div></div>
    <div className="card"><h2>Notifications</h2>
      <Chk k="notifications_enabled" label="Enable Chrome notifications" />
      <Chk k="notify_first_link_click" label="First link click per email" /><Chk k="notify_document_visit" label="Tracked document page visit" />
      <label className="chk">Follow-up reminder after <input type="number" min={1} max={60} value={s.followup_reminder_days ?? ''} placeholder="off" onChange={(e) => save({ followup_reminder_days: e.target.value ? Math.min(60, Math.max(1, Number(e.target.value))) : null })} /> days (applies to emails sent after you set it)</label>
      <p className="muted small">Opens never trigger notifications. Reply detection is unavailable, so a reminder does not mean the email was unread or unanswered.</p></div>
    <div className="card"><h2>Data retention and deletion</h2>
      <label className="chk">Automatically delete tracked emails after <input type="number" min={7} max={730} value={s.retention_days} onChange={(e) => save({ retention_days: Math.min(730, Math.max(7, Number(e.target.value) || 90)) })} /> days</label>
      <p><button className="danger" onClick={wipe}>Delete all my tracking data</button></p></div>
    <div className="card small"><h2>What is and is not trackable</h2><ul>
      <li><b>Open signal:</b> imperfect. Image proxies, privacy features and prefetching can trigger it or hide real opens.</li>
      <li><b>Link clicks and document page visits:</b> observed when the recipient uses your tracked link. Security scanners can also click; those are labelled.</li>
      <li><b>Not detected:</b> replies, bounces, forwards, and whether an attached file was opened. No email text is stored.</li></ul></div>
    {msg && <p className="notice">{msg}</p>}
  </>);
}
