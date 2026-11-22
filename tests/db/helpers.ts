import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = join(__dirname, '..', '..');

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, 'supabase-shim.sql'), 'utf8'));
  const dir = join(root, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

/** Run one statement as a Supabase-style role (anon | authenticated | service_role), in its own transaction. */
export async function as(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    const res = await db.query<any>(sql, params);
    await db.exec('commit');
    return res;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

/** Superuser helper for fixtures. */
export const sys = (db: PGlite, sql: string, params: unknown[] = []) => db.query<any>(sql, params);

export const hash32 = () => new Uint8Array(randomBytes(32));

export async function makeUser(db: PGlite, email: string): Promise<string> {
  const r = await sys(db, `insert into auth.users (email) values ($1) returning id`, [email]);
  return r.rows[0].id;
}

export async function makeEmail(db: PGlite, userId: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = await sys(
    db,
    `insert into public.tracked_emails (user_id, pixel_token_hash, recipients, subject, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [userId, hash32(), (over.recipients as string[]) ?? ['a@example.com'], over.subject ?? 'Hi', over.status ?? 'send_confirmed'],
  );
  return r.rows[0].id;
}
