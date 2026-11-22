import { describe, it, expect } from 'vitest';
import { planNotifications, type Ev } from '../src/notify-plan';
import { isAllowedApiPath } from '../src/shared/api-paths';
import { statusLabel, filterEmails, type Email, type Event } from '../src/app/labels';

const names = { emails: { e1: { subject: 'Intro', recipients: ['bob@x.com'] } }, links: { l1: 'Portfolio' }, docs: { d1: 'CV' } };
const ev = (o: Partial<Ev>): Ev => ({ id: Math.random().toString(), email_id: 'e1', event_type: 'link_clicked', confidence: 'likely_human', link_id: 'l1', document_id: null, created_at: '', ...o });
const prefs = { first_link_click: true, document_visit: true };

describe('notification planning', () => {
  it('notifies once per email for link clicks and once per document, never for opens', () => {
    const p = planNotifications([ev({}), ev({}), ev({ event_type: 'open_signal', link_id: null }), ev({ event_type: 'document_visit', link_id: null, document_id: 'd1' }), ev({ event_type: 'document_visit', link_id: null, document_id: 'd1' })], names, [], prefs);
    expect(p.map((x) => x.key)).toEqual(['click:e1', 'doc:d1']);
  });
  it('skips already-notified keys, automated activity and disabled categories; flags uncertain ones', () => {
    expect(planNotifications([ev({})], names, ['click:e1'], prefs)).toEqual([]);
    expect(planNotifications([ev({ confidence: 'likely_automated' })], names, [], prefs)).toEqual([]);
    expect(planNotifications([ev({})], names, [], { ...prefs, first_link_click: false })).toEqual([]);
    expect(planNotifications([ev({ confidence: 'uncertain' })], names, [], prefs)[0].title).toContain('could be automated');
  });
});

describe('API path allowlist (Gmail page -> background)', () => {
  it('allows only the three tracking-lifecycle paths', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    for (const p of ['/api/emails', `/api/emails/${id}/injected`, `/api/emails/${id}/confirm-sent`]) expect(isAllowedApiPath(p)).toBe(true);
    for (const p of ['/api/cron/purge', '/api/emails/../health', `/api/emails/${id}`, '/api/emails/abc/injected', 'https://evil.com/api/emails', 42, undefined]) expect(isAllowedApiPath(p)).toBe(false);
  });
});

describe('labels and filters', () => {
  it('only send_confirmed counts as tracked', () => {
    expect(statusLabel('send_confirmed').tone).toBe('ok');
    expect(statusLabel('injected').text).toContain('not confirmed'); expect(statusLabel('registered').tone).toBe('bad');
  });
  const mk = (id: string, subject: string, to: string, days: number): Email => ({ id, recipients: [to], subject, status: 'send_confirmed', pixel_injected: true, links_rewritten: 0,
    created_at: new Date(Date.now() - days * 86400000).toISOString(), send_confirmed_at: new Date(Date.now() - days * 86400000).toISOString(), last_activity_at: null, followup_due_at: null });
  const emails = [mk('a', 'Intro to Acme', 'ann@acme.com', 2), mk('b', 'Partnership', 'bob@beta.io', 40), mk('c', 'Hello', 'cy@acme.com', 3)];
  const events = [{ id: '1', email_id: 'a', event_type: 'link_clicked' }, { id: '2', email_id: 'b', event_type: 'document_visit' }, { id: '3', email_id: 'a', event_type: 'email_sent' }] as Event[];
  it('searches by recipient/subject, date and activity type (email_sent is not activity)', () => {
    const ids = (f: any) => filterEmails(emails, events, { q: '', days: null, activity: 'any', ...f }).map((e) => e.id);
    expect(ids({ q: 'acme' })).toEqual(['a', 'c']); expect(ids({ q: 'partner' })).toEqual(['b']);
    expect(ids({ days: 7 })).toEqual(['a', 'c']); expect(ids({ activity: 'link_clicked' })).toEqual(['a']);
    expect(ids({ activity: 'document_visit' })).toEqual(['b']); expect(ids({ activity: 'none' })).toEqual(['c']);
  });
});
