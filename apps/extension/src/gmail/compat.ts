// ALL Gmail DOM knowledge lives in this file. Gmail's markup is undocumented and changes; every lookup here
// tolerates failure (returns null / [] / false) and never throws, so a Gmail change disables tracking instead of breaking Gmail.
export const SEL = {
  body: ['div[aria-label="Message Body"][contenteditable="true"]', 'div[role="textbox"][g_editable="true"]', 'div[contenteditable="true"][aria-label*="Message Body" i]'],
  root: ['div[role="dialog"]', 'div.AD', 'div.aoI', 'div.M9'],
  subject: ['input[name="subjectbox"]', 'input[aria-label="Subject"]'],
  send: ['div[role="button"][data-tooltip^="Send"]', 'div[role="button"][aria-label^="Send"]', 'div.T-I.J-J5-Ji.aoO'],
  toolbar: ['div.btC', 'td.gU.Up', 'div[role="toolbar"]'],
  recipientInputs: ['input[name="to"]', 'input[name="cc"]', 'input[name="bcc"]'],
  toast: ['[role="alert"]', '[aria-live]', 'span.bAq', 'div.b8'],
};

export type Undos = Array<() => void>;
export type Compose = { root: HTMLElement; body: HTMLElement };

function tryQuery(root: ParentNode, sel: string): HTMLElement | null { try { return root.querySelector<HTMLElement>(sel); } catch { return null; } }
function first(root: ParentNode, sels: string[]): HTMLElement | null { for (const s of sels) { const r = tryQuery(root, s); if (r) return r; } return null; }
function depth(el: Element): number { let d = 0; for (let p: Element | null = el; p; p = p.parentElement) d++; return d; }
function nearestRoot(b: Element): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const s of SEL.root) { try { const c = b.closest<HTMLElement>(s); if (c && (!best || depth(c) > depth(best))) best = c; } catch { /* bad selector */ } }
  return best;
}
function ancestorWithSend(b: Element): HTMLElement | null {
  let p = b.parentElement;
  for (let i = 0; p && i < 14; i++, p = p.parentElement) if (first(p, SEL.send)) return p;
  return null;
}

export function findComposes(doc: Document): Compose[] {
  const out: Compose[] = []; const seen = new Set<Element>();
  for (const s of SEL.body) {
    let nodes: NodeListOf<HTMLElement>;
    try { nodes = doc.querySelectorAll<HTMLElement>(s); } catch { continue; }
    nodes.forEach((b) => {
      if (seen.has(b)) return; seen.add(b);
      const root = nearestRoot(b) ?? ancestorWithSend(b);
      if (root) out.push({ root, body: b });
    });
  }
  return out;
}

export const findSendButton = (root: ParentNode) => first(root, SEL.send);
export const findToolbar = (root: ParentNode) => first(root, SEL.toolbar);

/** A compose is supported only if we can find what we need to inject and to see Send. */
export function compatReport(root: ParentNode, body: HTMLElement | null): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!body || !body.isConnected) missing.push('message body');
  if (!findSendButton(root)) missing.push('Send button');
  return { ok: missing.length === 0, missing };
}

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function getRecipients(root: ParentNode): string[] {
  const set = new Set<string>();
  const add = (s: string | null | undefined) => { for (const m of (s ?? '').match(EMAIL_RE) ?? []) set.add(m.toLowerCase()); };
  try { root.querySelectorAll('[email]').forEach((el) => add(el.getAttribute('email'))); } catch { /* ignore */ }
  for (const s of SEL.recipientInputs) { try { root.querySelectorAll<HTMLInputElement>(s).forEach((el) => add(el.value)); } catch { /* ignore */ } }
  return [...set].slice(0, 50);
}
export function getSubject(root: ParentNode): string | null {
  const el = first(root, SEL.subject) as HTMLInputElement | null;
  const v = el?.value?.trim();
  return v ? v.slice(0, 500) : null;
}

// ---- reading the body: only link URLs and link text are read; the body text is never read or stored ----
export type FoundLink = { url: string; label: string };
export function collectLinks(body: HTMLElement, trackingBase: string): FoundLink[] {
  const baseHost = safeHost(trackingBase); const out: FoundLink[] = []; const seen = new Set<string>();
  body.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') ?? '').trim();
    let u: URL; try { u = new URL(href); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (u.hostname === baseHost || seen.has(href) || out.length >= 50) return;
    seen.add(href);
    out.push({ url: href, label: ((a.textContent ?? '').trim() || u.hostname).slice(0, 100) });
  });
  return out;
}
const safeHost = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

// ---- injection (each change registers an undo) ----
export function injectPixel(body: HTMLElement, pixelUrl: string, undo: Undos): boolean {
  const doc = body.ownerDocument;
  const wrap = doc.createElement('div'); wrap.setAttribute('data-aftersend', 'pixel');
  const img = doc.createElement('img');
  img.setAttribute('src', pixelUrl); img.setAttribute('width', '1'); img.setAttribute('height', '1');
  img.setAttribute('alt', ''); img.setAttribute('style', 'border:0;width:1px;height:1px;');
  wrap.appendChild(img); body.appendChild(wrap);
  undo.push(() => wrap.remove());
  return hasPixel(body, pixelUrl);
}
export function hasPixel(body: ParentNode, pixelUrl: string): boolean {
  return [...body.querySelectorAll('img')].some((i) => i.getAttribute('src') === pixelUrl);
}
export type LinkMap = { destination_url: string; original_urls: string[]; tracked_url: string };
export function applyTrackedLinks(body: HTMLElement, map: LinkMap[], undo: Undos): number {
  let n = 0;
  body.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') ?? '').trim();
    const m = map.find((x) => x.original_urls.some((o) => o.trim() === href) || x.destination_url === href);
    if (!m) return;
    const old = a.getAttribute('href') as string;
    a.setAttribute('href', m.tracked_url); a.setAttribute('data-aftersend', 'link');
    undo.push(() => { a.setAttribute('href', old); a.removeAttribute('data-aftersend'); });
    n++;
  });
  return n;
}
export function appendDocumentLinks(body: HTMLElement, docs: { title: string; landing_url: string }[], undo: Undos): number {
  if (!docs.length) return 0;
  const doc = body.ownerDocument; const wrap = doc.createElement('div'); wrap.setAttribute('data-aftersend', 'documents');
  for (const d of docs) {
    const line = doc.createElement('div'); const a = doc.createElement('a');
    a.setAttribute('href', d.landing_url); a.textContent = d.title; line.appendChild(a); wrap.appendChild(line);
  }
  body.appendChild(wrap); undo.push(() => wrap.remove());
  return docs.filter((d) => [...body.querySelectorAll('a')].some((a) => a.getAttribute('href') === d.landing_url)).length;
}
export function revert(undo: Undos): void { while (undo.length) { try { undo.pop()!(); } catch { /* ignore */ } } }

/** Gmail buttons react to mouse events, so emulate the full sequence. */
export function triggerSend(btn: HTMLElement): void {
  const win = btn.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const Ev = win?.MouseEvent ?? MouseEvent;
  for (const type of ['mousedown', 'mouseup', 'click']) btn.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true }));
}

/** Looks for Gmail's "Message sent" confirmation (English UI only). */
export function toastVisible(doc: Document): boolean {
  for (const s of SEL.toast) {
    let nodes: NodeListOf<Element>; try { nodes = doc.querySelectorAll(s); } catch { continue; }
    for (const n of nodes) if (/message sent/i.test(n.textContent ?? '')) return true;
  }
  return false;
}
