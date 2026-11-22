// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { findComposes, compatReport, getRecipients, getSubject, collectLinks, injectPixel, applyTrackedLinks, appendDocumentLinks, revert, findSendButton, toastVisible, hasPixel } from '../src/gmail/compat';
import { GMAIL_HTML, BASE } from './fixture';

beforeEach(() => { document.body.innerHTML = GMAIL_HTML; });
const compose = () => findComposes(document)[0];

describe('Gmail compatibility layer', () => {
  it('finds the compose window, subject and de-duplicated recipients', () => {
    const c = compose();
    expect(c.root.id).toBe('root1');
    expect(getSubject(c.root)).toBe('Hello there');
    expect(getRecipients(c.root).sort()).toEqual(['bob@example.com', 'carol@example.com']);
    expect(compatReport(c.root, c.body)).toEqual({ ok: true, missing: [] });
  });
  it('reports unsupported (without throwing) when Gmail markup changes', () => {
    document.querySelector('[role=button]')!.remove();
    const c = compose();
    expect(compatReport(c.root, c.body)).toEqual({ ok: false, missing: ['Send button'] });
    document.body.innerHTML = '<div>totally different UI</div>';
    expect(findComposes(document)).toEqual([]);
    expect(getRecipients(document.body)).toEqual([]);
    expect(getSubject(document.body)).toBeNull();
    expect(findSendButton(document.body)).toBeNull();
  });
  it('collects only http(s) links, skipping mailto, duplicates and already-tracked links', () => {
    expect(collectLinks(compose().body, BASE)).toEqual([{ url: 'https://example.com/a', label: 'my site' }]);
  });
  it('injects a pixel, rewrites every matching anchor, appends document links, and can fully undo', () => {
    const { body } = compose(); const before = body.innerHTML; const undo: (() => void)[] = [];
    expect(injectPixel(body, `${BASE}/api/t/T.gif`, undo)).toBe(true);
    expect(applyTrackedLinks(body, [{ destination_url: 'https://example.com/a', original_urls: ['https://example.com/a'], tracked_url: `${BASE}/api/l/L` }], undo)).toBe(2);
    expect(appendDocumentLinks(body, [{ title: 'My CV', landing_url: `${BASE}/d/D` }], undo)).toBe(1);
    expect(hasPixel(body, `${BASE}/api/t/T.gif`)).toBe(true);
    expect(body.querySelector('a[href="mailto:x@y.com"]')).not.toBeNull();   // untouched
    revert(undo);
    expect(body.innerHTML).toBe(before);
  });
  it('detects the "Message sent" toast', () => {
    expect(toastVisible(document)).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<div role="alert">Message sent. <a>Undo</a></div>');
    expect(toastVisible(document)).toBe(true);
  });
});
