// Writes apps/extension/.env.local. Refuses secret keys. Run: npm run setup:extension
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const apiEnv = join(root, 'apps', 'api', '.env.local'); const o = {};
if (existsSync(apiEnv)) for (const l of readFileSync(apiEnv, 'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2]; }

function askHidden(q) {
  return new Promise((resolve) => {
    process.stdout.write(q); let buf = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const on = (ch) => { for (const c of ch) {
      if (c === '\r' || c === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); return resolve(buf.trim()); }
      if (c === '\u0003') process.exit(130);
      if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c; } };
    process.stdin.on('data', on);
  });
}
const url = o.SUPABASE_URL;
if (!url) { console.log('apps/api/.env.local has no SUPABASE_URL. Finish the API setup first.'); process.exit(1); }
const key = process.env.SUPABASE_PUBLISHABLE_KEY || await askHidden('Paste your Supabase PUBLISHABLE key (sb_publishable_...), then press Enter: ');
if (key.startsWith('sb_secret_')) { console.log('\nThat is the SECRET key. It must never go in the extension. Nothing was written.'); process.exit(1); }
if (!key.startsWith('sb_publishable_')) { console.log('\nThat does not look like a publishable key. Nothing was written.'); process.exit(1); }
const api = o.TRACKING_BASE_URL || 'http://localhost:3000';
writeFileSync(join(root, 'apps', 'extension', '.env.local'), `EXT_SUPABASE_URL=${url}\nEXT_SUPABASE_ANON_KEY=${key}\nEXT_API_BASE_URL=${api}\n`);
console.log(`\nSaved apps/extension/.env.local (API address: ${api}). Next: npm run build:extension`);
