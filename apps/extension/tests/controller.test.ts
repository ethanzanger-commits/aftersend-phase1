// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComposeController, installSendInterceptor, stateText, type Reply } from '../src/content-core';
import { findComposes, hasPixel } from '../src/gmail/compat';
import { GMAIL_HTML, BASE } from './fixture';

const PIXEL = `${BASE}/api/t/TOKENTOKENTOKENTOKEN12.gif`;
const OK_REG: Reply = { ok: true, status: 201, data: { email_id: 'e1', pixel_url: PIXEL,
  links: [{ destination_url: 'https://example.com/a', original_urls: ['https://example.com/a'], tracked_url: `${BASE}/api/l/L1` }],
  documents: [{ title: 'CV', landing_url: `${BASE}/d/D1` }], rejected: [] } };

let calls: any[]; let gmailSent: number; let script: Record<string, Reply>;
let ctrl: ComposeController; let stop: () => void;
const send = vi.fn(async (m: any): Promise<Reply> => {
  calls.push(m);
  if (m.type === 'auth') return script.auth ?? { ok: true, signedIn: true };
  const key = m.path.replace(/\/api\/emails\/[^/]+\//, '/api/emails/ID/');
  return script[key] ?? { ok: true, status: 200, data: {} };
});

function setup(opts: { gmailBehaviour?: 'sends' | 'ignores' | 'sends-then-undo' } = {}) {
  document.body.innerHTML = GMAIL_HTML;
  calls = []; gmailSent = 0;
  script = { '/api/emails': OK_REG, '/api/emails/ID/injected': { ok: true, status: 200 }, '/api/emails/ID/confirm-sent': { ok: true, status: 200, data: { status: 'send_confirmed' } } };
  const btn = document.querySelector<HTMLElement>('[role=button]')!;
  // Fake Gmail: sends on mouseup (like the real button): closes compose and shows the toast.
  btn.addEventListener('mouseup', () => {
    gmailSent++;
    if (opts.gmailBehaviour === 'ignores') return;
    const html = document.querySelector('[role=textbox]')!.innerHTML;
    document.getElementById('root1')!.remove();
    document.body.insertAdjacentHTML('beforeend', '<div role="alert">Message sent.</div>');
    if (opts.gmailBehaviour === 'sends-then-undo') setTimeout(() => document.body.insertAdjacentHTML('beforeend',
      `<div role="dialog"><div aria-label="Message Body" contenteditable="true">${html}</div><div role="button" aria-label="Send">Send</div></div>`), 5);
  });
  const c = findComposes(document)[0];
  ctrl = new ComposeController(c.root, c.body, { doc: document, send, trackingBase: BASE, getDocuments: async () => [{ title: 'CV', url: 'https://example.com/cv.pdf' }],
    undoWindowMs: 40, sentTimeoutMs: 400, pollMs: 5 });
  stop?.(); stop = installSendInterceptor(document, () => [ctrl]);
  return btn;
}
const userClicksSend = (btn: HTMLElement) => ['mousedown', 'mouseup', 'click'].forEach((t) => btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
const paths = () => calls.filter((c) => c.type === 'api').map((c) => c.path.replace(/\/api\/emails\/[^/]+\//, '/api/emails/ID/'));

describe('toggle off: Gmail behaves normally', () => {
  it('does not intercept or call the server', async () => {
    const btn = setup();
    userClicksSend(btn);
    expect(gmailSent).toBe(1); expect(calls).toEqual([]);
  });
});

describe('happy path', () => {
  it('registers, injects, reports, sends, then confirms - in that order, and only then says "Tracked and sent"', async () => {
    const btn = setup(); ctrl.opts.docs.add(0); ctrl.setEnabled(true);
    expect(stateText(ctrl.state)).toContain('not tracked yet');
    userClicksSend(btn);
    expect(gmailSent).toBe(0);                        // Send was held back while we set up
    await ctrl.whenIdle();
    expect(gmailSent).toBe(1);                        // exactly one real send
    expect(paths()).toEqual(['/api/emails', '/api/emails/ID/injected', '/api/emails/ID/confirm-sent']);
    expect(calls.find((c) => c.path === '/api/emails/e1/injected').body).toEqual({ pixel_injected: true, links_rewritten: 2 });
    expect(calls[1].body).toMatchObject({ subject: 'Hello there', links: [{ url: 'https://example.com/a', label: 'my site' }], documents: [{ title: 'CV' }] });
    expect(JSON.stringify(calls)).not.toContain('Hi ');   // body text is never sent to the server
    expect(ctrl.state.kind).toBe('confirmed');
  });
  it('Ctrl+Enter is intercepted too', async () => {
    const btn = setup(); ctrl.setEnabled(true);
    document.querySelector('[role=textbox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await ctrl.whenIdle();
    expect(gmailSent).toBe(1); expect(ctrl.state.kind).toBe('confirmed'); expect(btn).toBeTruthy();
  });
});

describe('failures never claim tracking and never leave half-modified emails', () => {
  const unchanged = () => !document.querySelector('[data-aftersend]') && document.querySelector('a[href="https://example.com/a"]');
  it('not signed in: no send, no registration', async () => {
    const btn = setup(); script.auth = { ok: true, signedIn: false }; ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle();
    expect(gmailSent).toBe(0); expect(paths()).toEqual([]); expect(ctrl.state.kind).toBe('error'); expect(stateText(ctrl.state)).toContain('NOT tracked');
  });
  it('registration fails: email untouched, not sent', async () => {
    const btn = setup(); script['/api/emails'] = { ok: false, status: 500, error: 'internal_error' }; ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle();
    expect(gmailSent).toBe(0); expect(unchanged()).toBeTruthy(); expect(ctrl.state.kind).toBe('error');
  });
  it('server rejects the injection report: DOM is reverted and the message is not sent', async () => {
    const btn = setup(); script['/api/emails/ID/injected'] = { ok: false, status: 409, error: 'cannot_mark_injected' }; ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle();
    expect(gmailSent).toBe(0); expect(unchanged()).toBeTruthy(); expect(paths()).not.toContain('/api/emails/ID/confirm-sent');
  });
  it('after an error the user can retry, or send without tracking', async () => {
    const btn = setup(); script['/api/emails'] = { ok: false, status: 429, error: 'rate_limited' }; ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle(); expect(gmailSent).toBe(0);
    ctrl.setEnabled(false);                                       // "Send without tracking"
    userClicksSend(btn); expect(gmailSent).toBe(1);
  });
  it('Gmail never confirms the send: stays "injected", is NOT confirmed', async () => {
    const btn = setup({ gmailBehaviour: 'ignores' }); ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle();
    expect(paths()).toEqual(['/api/emails', '/api/emails/ID/injected']);
    expect(ctrl.state.kind).toBe('unconfirmed'); expect(stateText(ctrl.state)).toContain('NOT marked as sent');
  });
  it('send undone within the undo window: not confirmed', async () => {
    const btn = setup({ gmailBehaviour: 'sends-then-undo' }); ctrl.setEnabled(true);
    userClicksSend(btn); await ctrl.whenIdle();
    expect(paths()).not.toContain('/api/emails/ID/confirm-sent'); expect(ctrl.state.kind).toBe('unconfirmed');
  });
  it('a held-back click does not double-register while setup is running', async () => {
    const btn = setup(); ctrl.setEnabled(true);
    userClicksSend(btn); userClicksSend(btn); await ctrl.whenIdle();
    expect(paths().filter((p) => p === '/api/emails')).toHaveLength(1); expect(gmailSent).toBe(1);
  });
});

describe('unsupported Gmail layout (explicit fallback)', () => {
  it('refuses to arm and says why', () => {
    const btn = setup(); btn.remove(); ctrl.setEnabled(true);
    expect(ctrl.state.kind).toBe('unsupported'); expect(ctrl.enabled).toBe(false);
    expect(stateText(ctrl.state)).toMatch(/link generator/);
  });
  it('pixel helper agrees with what is in the body', () => {
    setup(); expect(hasPixel(document.body, PIXEL)).toBe(false);
  });
});
