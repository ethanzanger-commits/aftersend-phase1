import { findToolbar } from './gmail/compat';
import { stateText, type ComposeController, type Deps } from './content-core';

const CSS = `:host{all:initial}*{box-sizing:border-box;font:12px/1.3 system-ui,sans-serif}
.wrap{display:inline-flex;align-items:center;gap:6px;position:relative;color:#202124}
.sw{width:30px;height:16px;border-radius:8px;border:0;background:#bbb;position:relative;cursor:pointer;padding:0}
.sw[aria-checked=true]{background:#1a73e8}.knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:6px;background:#fff;transition:left .12s}
.sw[aria-checked=true] .knob{left:16px}.lbl{font-weight:600}.st{max-width:300px;color:#5f6368}.st.err{color:#b3261e}.st.ok{color:#137333}
.gear{border:0;background:none;cursor:pointer;font-size:14px;padding:0 2px}
.pop{position:absolute;bottom:26px;left:0;z-index:99999;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:10px;box-shadow:0 2px 10px #0003;min-width:240px}
.pop label{display:block;margin:4px 0}.pop small{display:block;color:#5f6368;margin-top:6px}
.act{border:1px solid #dadce0;background:#fff;border-radius:4px;cursor:pointer;padding:2px 6px}`;

export function mountToggle(ctrl: ComposeController, deps: Deps) {
  const doc = deps.doc; const host = doc.createElement('span'); host.setAttribute('data-aftersend-ui', '1');
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>${CSS}</style><div class="wrap"><button class="sw" role="switch" aria-checked="false" aria-label="Track this email"><span class="knob"></span></button>
  <span class="lbl">Track this email</span><button class="gear" title="Tracking options">&#9881;</button><span class="st"></span>
  <span class="acts"></span><div class="pop" hidden></div></div>`;
  const $ = <T extends Element>(s: string) => sh.querySelector(s) as T;
  const sw = $<HTMLButtonElement>('.sw'), st = $<HTMLElement>('.st'), pop = $<HTMLElement>('.pop'), acts = $<HTMLElement>('.acts');

  sw.onclick = () => ctrl.setEnabled(!ctrl.enabled);
  $<HTMLButtonElement>('.gear').onclick = async () => {
    if (!pop.hidden) { pop.hidden = true; return; }
    const docs = await deps.getDocuments().catch(() => []);
    pop.innerHTML = `<label><input type="checkbox" data-k="pixel" ${ctrl.opts.pixel ? 'checked' : ''}> Open-signal pixel (imperfect)</label>
      <label><input type="checkbox" data-k="links" ${ctrl.opts.links ? 'checked' : ''}> Track links</label>
      ${docs.length ? '<b>Tracked document links</b>' : ''}${docs.map((d, i) => `<label><input type="checkbox" data-d="${i}" ${ctrl.opts.docs.has(i) ? 'checked' : ''}> <span class="t"></span></label>`).join('')}
      <small>Applies to Send button and Ctrl+Enter only. Add documents in the AfterSend app.</small>`;
    pop.querySelectorAll<HTMLElement>('.t').forEach((s, i) => { s.textContent = docs[i].title; });   // textContent: titles are never parsed as HTML
    pop.querySelectorAll<HTMLInputElement>('input').forEach((c) => c.onchange = () => {
      if (c.dataset.k) (ctrl.opts as any)[c.dataset.k] = c.checked;
      if (c.dataset.d !== undefined) { const i = Number(c.dataset.d); c.checked ? ctrl.opts.docs.add(i) : ctrl.opts.docs.delete(i); }
    });
    pop.hidden = false;
  };
  const render = () => {
    const s = ctrl.state; sw.setAttribute('aria-checked', String(ctrl.enabled));
    st.textContent = stateText(s); st.className = 'st' + (s.kind === 'error' || s.kind === 'unsupported' || s.kind === 'unconfirmed' ? ' err' : s.kind === 'confirmed' ? ' ok' : '');
    acts.textContent = '';
    if (s.kind === 'error') {
      const mk = (t: string, f: () => void) => { const b = doc.createElement('button'); b.className = 'act'; b.textContent = t; b.onclick = f; acts.appendChild(b); };
      mk('Retry', () => void ctrl.startSend());
      mk('Send without tracking', () => { ctrl.setEnabled(false); ctrl.root.querySelector<HTMLElement>('[role=button][aria-label^="Send"],[role=button][data-tooltip^="Send"]')?.click(); });
    }
  };
  ctrl.onChange = render; render();
  const bar = findToolbar(ctrl.root);
  if (bar) bar.appendChild(host);
  else { host.style.cssText = 'position:absolute;top:4px;right:48px;z-index:99998;background:#fff;padding:2px 6px;border-radius:6px'; ctrl.root.appendChild(host); }
}

/** Page-level notice that survives the compose window closing. */
export function toast(doc: Document, text: string, bad: boolean) {
  const t = doc.createElement('div'); t.setAttribute('data-aftersend-ui', 'toast');
  t.style.cssText = `position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:10px 14px;border-radius:8px;color:#fff;font:13px system-ui;background:${bad ? '#b3261e' : '#137333'}`;
  t.textContent = text; doc.body.appendChild(t); setTimeout(() => t.remove(), 9000);
}
