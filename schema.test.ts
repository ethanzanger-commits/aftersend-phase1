import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, as, sys, hash32, makeUser, makeEmail } from './helpers';

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => { db = await createDb(); });
beforeEach(async () => {
  await sys(db, 'delete from auth.users');
  alice = await makeUser(db, 'alice@example.com');
  bob = await makeUser(db, 'bob@example.com');
});

const addLink = async (userId: string, emailId: string, url = 'https://example.com/a') =>
  (await sys(db, `insert into public.tracked_links (user_id,email_id,token_hash,destination_url,label)
                  values ($1,$2,$3,$4,'Portfolio') returning id`, [userId, emailId, hash32(), url])).rows[0].id as string;
const addDoc = async (userId: string, emailId: string) =>
  (await sys(db, `insert into public.tracked_documents (user_id,email_id,token_hash,title,destination_url)
                  values ($1,$2,$3,'CV','https://example.com/cv.pdf') returning id`, [userId, emailId, hash32()])).rows[0].id as string;
const addEvent = (userId: string, emailId: string, type: string, source: string, key: string, linkId: string | null = null, docId: string | null = null) =>
  sys(db, `insert into public.email_events (user_id,email_id,link_id,document_id,event_type,source,dedupe_key)
           values ($1,$2,$3,$4,$5,$6,$7)`, [userId, emailId, linkId, docId, type, source, key]);

describe('migrations', () => {
  it('creates all five tables with RLS enabled', async () => {
    const r = await sys(db, `select relname, relrowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`);
    expect(r.rows.map((x: any) => x.relname)).toEqual(
      ['email_events', 'tracked_documents', 'tracked_emails', 'tracked_links', 'user_settings']);
    expect(r.rows.every((x: any) => x.relrowsecurity)).toBe(true);
  });
});

describe('user_settings', () => {
  it('is auto-created with conservative defaults', async () => {
    const r = await as(db, 'authenticated', alice, 'select * from public.user_settings');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ retention_days: 90, notifications_enabled: false });
  });
  it('lets a user update their own settings but not others', async () => {
    await as(db, 'authenticated', alice, 'update public.user_settings set retention_days = 30');
    const mine = await as(db, 'authenticated', alice, 'select retention_days from public.user_settings');
    expect(mine.rows[0].retention_days).toBe(30);
    const bobs = await sys(db, 'select retention_days from public.user_settings where user_id = $1', [bob]);
    expect(bobs.rows[0].retention_days).toBe(90);
  });
  it('rejects out-of-range retention', async () => {
    await expect(as(db, 'authenticated', alice, 'update public.user_settings set retention_days = 1')).rejects.toThrow();
  });
});

describe('row level security', () => {
  it('isolates tracked emails, links, documents and events per user', async () => {
    const e = await makeEmail(db, alice);
    const l = await addLink(alice, e);
    const d = await addDoc(alice, e);
    await addEvent(alice, e, 'open_signal', 'pixel', 'k1');
    for (const t of ['tracked_emails', 'tracked_links', 'tracked_documents', 'email_events']) {
      expect((await as(db, 'authenticated', alice, `select 1 from public.${t}`)).rows).toHaveLength(1);
      expect((await as(db, 'authenticated', bob, `select 1 from public.${t}`)).rows).toHaveLength(0);
      expect((await as(db, 'anon', null, `select 1 from public.${t}`).catch(() => 'denied'))).toBe('denied');
    }
    expect(l && d).toBeTruthy();
  });
  it('blocks client writes to tracking tables (server-only)', async () => {
    const e = await makeEmail(db, alice);
    await expect(as(db, 'authenticated', alice,
      `insert into public.tracked_emails (user_id,pixel_token_hash) values ($1,$2)`, [alice, hash32()])).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', alice,
      `update public.tracked_emails set status='failed' where id=$1`, [e])).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', alice,
      `insert into public.email_events (user_id,email_id,event_type,source,dedupe_key) values ($1,$2,'open_signal','pixel','x')`,
      [alice, e])).rejects.toThrow(/permission denied/);
  });
  it('lets a user delete only their own emails (cascade)', async () => {
    const mine = await makeEmail(db, alice);
    const theirs = await makeEmail(db, bob);
    const l = await addLink(alice, mine);
    await addEvent(alice, mine, 'link_clicked', 'redirect', 'c1', l);
    await as(db, 'authenticated', alice, 'delete from public.tracked_emails where id = $1', [theirs]);
    expect((await sys(db, 'select 1 from public.tracked_emails where id=$1', [theirs])).rows).toHaveLength(1);
    await as(db, 'authenticated', alice, 'delete from public.tracked_emails where id = $1', [mine]);
    expect((await sys(db, 'select 1 from public.tracked_links')).rows).toHaveLength(0);
    expect((await sys(db, 'select 1 from public.email_events')).rows).toHaveLength(0);
  });
  it('delete_my_tracking_data removes only the caller\'s data', async () => {
    await makeEmail(db, alice); await makeEmail(db, alice); await makeEmail(db, bob);
    const r = await as(db, 'authenticated', alice, 'select public.delete_my_tracking_data() as n');
    expect(r.rows[0].n).toBe(2);
    expect((await sys(db, 'select 1 from public.tracked_emails')).rows).toHaveLength(1);
    await expect(as(db, 'anon', null, 'select public.delete_my_tracking_data()')).rejects.toThrow(/permission denied/);
  });
  it('deleting a user removes all their data and settings', async () => {
    const e = await makeEmail(db, alice);
    await addEvent(alice, e, 'email_sent', 'extension', 'sent');
    await sys(db, 'delete from auth.users where id=$1', [alice]);
    expect((await sys(db, 'select 1 from public.tracked_emails where user_id=$1', [alice])).rows).toHaveLength(0);
    expect((await sys(db, 'select 1 from public.user_settings where user_id=$1', [alice])).rows).toHaveLength(0);
  });
});

describe('integrity constraints', () => {
  it('deduplicates events per email by dedupe_key', async () => {
    const e = await makeEmail(db, alice);
    await addEvent(alice, e, 'open_signal', 'pixel', 'same');
    await expect(addEvent(alice, e, 'open_signal', 'pixel', 'same')).rejects.toThrow(/unique|duplicate/i);
    await addEvent(alice, e, 'open_signal', 'pixel', 'different');
  });
  it('rejects unsafe or non-http(s) destination URLs', async () => {
    const e = await makeEmail(db, alice);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com/a', '//evil.com', 'https://a.com/ b']) {
      await expect(addLink(alice, e, bad)).rejects.toThrow(/check/i);
    }
    await addLink(alice, e, 'https://ok.example.com/path?q=1');
  });
  it('rejects mismatched event types, sources and targets', async () => {
    const e = await makeEmail(db, alice);
    const l = await addLink(alice, e);
    await expect(addEvent(alice, e, 'open_signal', 'redirect', 'a')).rejects.toThrow(/check/i);
    await expect(addEvent(alice, e, 'link_clicked', 'redirect', 'b')).rejects.toThrow(/check/i);        // no link_id
    await expect(addEvent(alice, e, 'open_signal', 'pixel', 'c', l)).rejects.toThrow(/check/i);        // stray link_id
    await expect(addEvent(alice, e, 'document_visit', 'landing_page', 'd')).rejects.toThrow(/check/i); // no document_id
    await addEvent(alice, e, 'link_clicked', 'redirect', 'ok', l);
  });
  it('prevents cross-user and cross-email references', async () => {
    const ea = await makeEmail(db, alice);
    const eb = await makeEmail(db, bob);
    await expect(addLink(bob, ea)).rejects.toThrow(/foreign key/i);              // bob claiming alice's email
    await expect(addEvent(bob, ea, 'open_signal', 'pixel', 'x')).rejects.toThrow(/foreign key/i);
    const la = await addLink(alice, ea);
    await expect(addEvent(bob, eb, 'link_clicked', 'redirect', 'y', la)).rejects.toThrow(/foreign key/i); // other email's link
  });
  it('requires 32-byte token hashes and rejects duplicate tokens', async () => {
    await expect(sys(db, `insert into public.tracked_emails (user_id,pixel_token_hash) values ($1,'\\x1234')`, [alice])).rejects.toThrow(/check/i);
    const h = hash32();
    await sys(db, `insert into public.tracked_emails (user_id,pixel_token_hash) values ($1,$2)`, [alice, h]);
    await expect(sys(db, `insert into public.tracked_emails (user_id,pixel_token_hash) values ($1,$2)`, [bob, h])).rejects.toThrow(/unique|duplicate/i);
  });
  it('bumps last_activity_at for real activity but not for email_sent', async () => {
    const e = await makeEmail(db, alice);
    await addEvent(alice, e, 'email_sent', 'extension', 's');
    expect((await sys(db, 'select last_activity_at from public.tracked_emails where id=$1', [e])).rows[0].last_activity_at).toBeNull();
    await addEvent(alice, e, 'open_signal', 'pixel', 'o');
    expect((await sys(db, 'select last_activity_at from public.tracked_emails where id=$1', [e])).rows[0].last_activity_at).not.toBeNull();
  });
});

describe('retention', () => {
  it('purges emails past each user\'s own retention window', async () => {
    await as(db, 'authenticated', bob, 'update public.user_settings set retention_days = 365');
    const oldA = await makeEmail(db, alice);   // alice default 90d
    const oldB = await makeEmail(db, bob);     // bob 365d
    const newA = await makeEmail(db, alice);
    await sys(db, `update public.tracked_emails set created_at = now() - interval '120 days' where id in ($1,$2)`, [oldA, oldB]);
    const r = await as(db, 'service_role', null, 'select public.purge_expired_data() as n');
    expect(r.rows[0].n).toBe(1);
    const left = (await sys(db, 'select id from public.tracked_emails')).rows.map((x: any) => x.id);
    expect(left.sort()).toEqual([oldB, newA].sort());
  });
  it('is not callable by clients', async () => {
    await expect(as(db, 'authenticated', alice, 'select public.purge_expired_data()')).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', null, 'select public.purge_expired_data()')).rejects.toThrow(/permission denied/);
  });
});
