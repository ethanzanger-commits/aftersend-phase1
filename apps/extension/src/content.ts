import { API_BASE } from './shared/api-base';
import { ComposeController, installSendInterceptor, type Deps, type Reply } from './content-core';
import { findComposes } from './gmail/compat';
import { mountToggle, toast } from './ui';

// Fail-safe: nothing here may throw into Gmail. Any problem leaves Gmail untouched.
function boot() {
  if (!chrome?.runtime?.id) return;
  const send = async (m: unknown): Promise<Reply> => { try { return await chrome.runtime.sendMessage(m); } catch { return { ok: false, error: 'network' }; } };
  const deps: Deps = {
    doc: document, send, trackingBase: API_BASE,
    getDocuments: async () => ((await chrome.storage.local.get('aftersend_documents')).aftersend_documents as { title: string; url: string }[]) ?? [],
  };
  const controllers = new Map<HTMLElement, ComposeController>();
  const scan = () => {
    try {
      for (const c of findComposes(document)) {
        if (controllers.has(c.root)) continue;
        const ctrl = new ComposeController(c.root, c.body, deps);
        mountToggle(ctrl, deps);
        const ui = ctrl.onChange;
        ctrl.onChange = (s) => {
          ui(s);
          if (s.kind === 'confirmed') toast(document, 'AfterSend: this email was tracked and sent.', false);
          if (s.kind === 'unconfirmed') toast(document, `AfterSend: tracking was added but the send was NOT confirmed. ${s.reason}`, true);
        };
        void send({ type: 'defaults' }).then((r) => { if (r.ok && r.data) { ctrl.opts.pixel = r.data.default_include_pixel !== false; ctrl.opts.links = r.data.default_rewrite_links !== false; } });
        controllers.set(c.root, ctrl);
      }
      for (const [root, c] of controllers) if (!root.isConnected && !c.busy) controllers.delete(root);
    } catch (e) { console.warn('[AfterSend] scan failed; Gmail left untouched', e); }
  };
  installSendInterceptor(document, () => controllers.values());
  let timer: number | undefined;
  new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(scan, 200); }).observe(document.body, { childList: true, subtree: true });
  scan();
}
try { boot(); } catch (e) { console.warn('[AfterSend] disabled', e); }
