import { useState } from 'react';
import { sb } from './api';

export function Auth() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (mode: 'in' | 'up') => {
    setBusy(true); setMsg('');
    const r = mode === 'in' ? await sb.auth.signInWithPassword({ email, password: pw }) : await sb.auth.signUp({ email, password: pw });
    setBusy(false);
    if (r.error) return setMsg(r.error.message);
    if (mode === 'up' && !r.data.session) setMsg('Account created. Check your email to confirm it, then sign in.');
  };
  return (<div className="auth card"><h1>AfterSend</h1><p className="muted">Sign in to see your tracked emails and to enable tracking in Gmail.</p>
    <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
    <div className="row"><button disabled={busy || !email || pw.length < 8} onClick={() => go('in')}>Sign in</button>
      <button className="ghost" disabled={busy || !email || pw.length < 8} onClick={() => go('up')}>Create account</button></div>
    {msg && <p className="notice">{msg}</p>}<p className="muted small">Passwords need at least 8 characters.</p></div>);
}
