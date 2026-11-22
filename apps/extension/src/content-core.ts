import { findComposes, compatReport, findSendButton, getRecipients, getSubject, collectLinks, applyTrackedLinks, injectPixel,
  appendDocumentLinks, revert, triggerSend, toastVisible, hasPixel, type Undos, type LinkMap } from './gmail/compat';

export type Reply<T = any> = { ok: boolean; status?: number; data?: T; error?: string; signedIn?: boolean };
export type Deps = {
  doc: Document; send: (m: unknown) => Promise<Reply>; trackingBase: string;
  getDocuments: () => Promise<{ title: string; url: string }[]>;
  sleep?: (ms: number) => Promise<void>; undoWindowMs?: number; sentTimeoutMs?: number; pollMs?: number;
};
export type State =
  | { kind: 'off' } | { kind: 'armed' } | { kind: 'preparing' }
  | { kind: 'unsupported'; missing: string[] } | { kind: 'error'; reason: string }
  | { kind: 'injected' } | { kind: 'confirmed' } | { kind: 'unconfirmed'; reason: string };

/** Honest status text. "Armed" is an intention, never a claim that tracking exists. */
export function stateText(s: State): string {
  switch (s.kind) {
    case 'off': return 'Tracking off';
    case 'armed': return 'On: set up when you click Send (not tracked yet)';
    case 'preparing': return 'Setting up tracking...';
    case 'unsupported': return `Not available in this Gmail view (missing: ${s.missing.join(', ')}). Use the AfterSend link generator instead.`;
    case 'error': return `NOT tracked: ${s.reason}`;
    case 'injected': return 'Tracking added. Waiting for Gmail to confirm the send...';
    case 'confirmed': return 'Tracked and sent';
    case 'unconfirmed': return `Tracking was added but the send was not confirmed. ${s.reason}`;
  }
}

const errText = (r: Reply): string => {
  if (r.error === 'unauthorized') return 'Not signed in or session expired. Click the AfterSend toolbar icon and sign in.';
  if (r.error === 'rate_limited') return 'Too many requests. Try again in a minute.';
  if (r.error === 'network') return 'Could not reach the AfterSend server.';
  return `Server refused the request (${r.error ?? r.status ?? 'unknown'}).`;
};

export class ComposeController {
  state: State = { kind: 'off' };
  enabled = false;
  bypass = false;
  busy = false;
  opts = { pixel: true, links: true, docs: new Set<number>() };
  emailId: string | null = null;
  private idle: Promise<void> = Promise.resolve();
  onChange: (s: State) => void = () => {};
  constructor(public root: HTMLElement, private body0: HTMLElement, private deps: Deps) {}

  private get sleep() { return this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))); }
  private set(s: State) { this.state = s; try { this.onChange(s); } catch { /* UI errors must not matter */ } }
  liveBody(): HTMLElement { return findComposes(this.deps.doc).find((c) => c.root === this.root)?.body ?? this.body0; }
  whenIdle() { return this.idle; }

  setEnabled(on: boolean) {
    if (this.busy) return;
    this.enabled = on; this.bypass = false;
    if (!on) return this.set({ kind: 'off' });
    const rep = compatReport(this.root, this.liveBody());
    if (!rep.ok) { this.enabled = false; return this.set({ kind: 'unsupported', missing: rep.missing }); }
    this.set({ kind: 'armed' });
  }

  shouldIntercept(e: Event): boolean {
    if (!this.enabled || this.bypass) return false;
    const t = e.target as Node | null; if (!t) return false;
    if (e.type === 'keydown') { const k = e as KeyboardEvent; return k.key === 'Enter' && (k.ctrlKey || k.metaKey) && this.root.contains(t); }
    const btn = findSendButton(this.root);
    return !!btn && btn.contains(t);
  }

  startSend(): Promise<void> {
    if (!this.busy) this.idle = this.prepareAndSend();
    return this.idle;
  }

  private fail(reason: string, undo?: Undos) { if (undo) revert(undo); this.set({ kind: 'error', reason }); this.bypass = false; }

  async prepareAndSend(): Promise<void> {
    if (this.busy) return; this.busy = true; this.set({ kind: 'preparing' });
    const d = this.deps; const undo: Undos = [];
    try {
      const auth = await d.send({ type: 'auth' });
      if (!auth.ok || !auth.signedIn) return this.fail('Not signed in. Click the AfterSend toolbar icon and sign in.');
      const body = this.liveBody(); const btn = findSendButton(this.root);
      const rep = compatReport(this.root, body);
      if (!rep.ok || !btn) return this.fail(`Gmail layout not recognised (missing: ${rep.missing.join(', ') || 'Send button'}).`);

      const docsAll = await d.getDocuments().catch(() => []);
      const docs = [...this.opts.docs].map((i) => docsAll[i]).filter(Boolean).map((x) => ({ title: x.title, url: x.url }));
      const links = this.opts.links ? collectLinks(body, d.trackingBase) : [];
      const reg = await d.send({ type: 'api', path: '/api/emails', body: { recipients: getRecipients(this.root), subject: getSubject(this.root), links, documents: docs } });
      if (!reg.ok || !reg.data?.email_id) return this.fail(errText(reg));
      const r = reg.data; this.emailId = r.email_id;

      const pixel = this.opts.pixel ? injectPixel(body, r.pixel_url, undo) : false;
      const rewritten = this.opts.links ? applyTrackedLinks(body, (r.links ?? []) as LinkMap[], undo) : 0;
      const docCount = appendDocumentLinks(body, r.documents ?? [], undo);
      if (docCount !== (r.documents ?? []).length) return this.fail('Could not add the document link to your message.', undo);
      if (!pixel && rewritten === 0) return this.fail('Nothing could be tracked: no pixel was added and no links were rewritten.', undo);

      const inj = await d.send({ type: 'api', path: `/api/emails/${r.email_id}/injected`, body: { pixel_injected: pixel, links_rewritten: rewritten } });
      if (!inj.ok) return this.fail(errText(inj), undo);
      if (pixel && !hasPixel(this.liveBody(), r.pixel_url)) return this.fail('Gmail removed the tracking pixel before sending.', undo);

      this.set({ kind: 'injected' }); this.bypass = true;
      triggerSend(btn);
      const outcome = await this.watchSent(r.pixel_url);
      if (outcome === 'unknown') return this.set({ kind: 'unconfirmed', reason: 'Gmail did not confirm in time. It is NOT marked as sent. If it was sent, tracking may still work.' });
      if (outcome === 'undone') return this.set({ kind: 'unconfirmed', reason: 'The send appears to have been undone.' });
      const c = await d.send({ type: 'api', path: `/api/emails/${r.email_id}/confirm-sent`, body: {} });
      this.set(c.ok ? { kind: 'confirmed' } : { kind: 'unconfirmed', reason: errText(c) });
    } catch (e) {
      console.warn('[AfterSend] unexpected error', e);
      this.fail('Unexpected error. Nothing was tracked.', undo);
    } finally { this.busy = false; }
  }

  /** 'sent' only when the compose closed AND Gmail's "Message sent" toast was seen AND it was not re-opened (undo). */
  private async watchSent(pixelUrl: string): Promise<'sent' | 'undone' | 'unknown'> {
    const d = this.deps; const end = Date.now() + (d.sentTimeoutMs ?? 20000); let toast = false;
    while (Date.now() < end) {
      if (toastVisible(d.doc)) toast = true;
      if (!this.root.isConnected && toast) {
        await this.sleep(d.undoWindowMs ?? 10000);
        return findComposes(d.doc).some((c) => hasPixel(c.body, pixelUrl)) ? 'undone' : 'sent';
      }
      await this.sleep(d.pollMs ?? 250);
    }
    return 'unknown';
  }
}

/** One capture-phase listener set for all composes. Swallows the user's Send only while tracking is armed. */
export function installSendInterceptor(doc: Document, controllers: () => Iterable<ComposeController>): () => void {
  const types = ['mousedown', 'mouseup', 'click', 'keydown'];
  const h = (e: Event) => {
    try {
      for (const c of controllers()) {
        if (!c.shouldIntercept(e)) continue;
        e.preventDefault(); e.stopImmediatePropagation();
        void c.startSend();
        return;
      }
    } catch { /* never break Gmail */ }
  };
  types.forEach((t) => doc.addEventListener(t, h, true));
  return () => types.forEach((t) => doc.removeEventListener(t, h, true));
}
