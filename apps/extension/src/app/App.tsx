import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { sb, loadAll } from './api';
import type { Email, Event, Names } from './labels';
import { Auth } from './Auth';
import { Dashboard } from './Dashboard';
import { Detail } from './Detail';
import { SettingsPage } from './SettingsPage';

export type Data = { emails: Email[]; events: Event[]; names: Names };
const useHash = () => { const [h, setH] = useState(location.hash || '#/'); useEffect(() => { const f = () => setH(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []); return h; };

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<Data | null>(null); const [err, setErr] = useState('');
  const hash = useHash();
  useEffect(() => { sb.auth.getSession().then(({ data }) => setSession(data.session)); const { data: l } = sb.auth.onAuthStateChange((_e, s) => setSession(s)); return () => l.subscription.unsubscribe(); }, []);
  const refresh = () => { setErr(''); loadAll().then(setData).catch((e) => setErr(e.message)); };
  useEffect(() => { if (session) refresh(); else setData(null); }, [session?.user.id]);

  if (session === undefined) return <p className="muted pad">Loading...</p>;
  if (!session) return <Auth />;
  const m = /^#\/email\/([0-9a-f-]{36})$/i.exec(hash);
  return (<div className="shell">
    <header><a className="brand" href="#/">AfterSend</a><nav><a href="#/" className={hash === '#/' ? 'on' : ''}>Dashboard</a><a href="#/settings" className={hash === '#/settings' ? 'on' : ''}>Settings</a></nav>
      <button className="link" onClick={refresh}>Refresh</button></header>
    <main>
      {err && <p className="notice bad">Could not load data: {err}</p>}
      {hash === '#/settings' ? <SettingsPage email={session.user.email ?? ''} onChanged={refresh} />
        : m ? (data ? <Detail data={data} id={m[1]} /> : <p className="muted">Loading...</p>)
        : data ? <Dashboard data={data} /> : <p className="muted">Loading...</p>}
    </main></div>);
}
