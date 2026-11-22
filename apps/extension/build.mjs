// Builds the Chrome extension into apps/extension/dist (or --out <dir>).
// Only the PUBLISHABLE Supabase key may be embedded. Secret / service-role keys are refused.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : join(here, 'dist');
const testConfig = args.includes('--test-config');

function readEnvFile(p) {
  const o = {}; if (!existsSync(p)) return o;
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2]; }
  return o;
}
const file = { ...readEnvFile(join(here, '.env')), ...readEnvFile(join(here, '.env.local')) };
const get = (k) => process.env[k] ?? file[k] ?? '';

export function resolveConfig() {
  if (testConfig) return { url: 'https://testproject.supabase.co', key: 'sb_publishable_test', api: 'https://track.example.com' };
  const url = get('EXT_SUPABASE_URL').replace(/\/+$/, ''), key = get('EXT_SUPABASE_ANON_KEY'), api = get('EXT_API_BASE_URL').replace(/\/+$/, '');
  const fail = (m) => { throw new Error('Extension config problem: ' + m); };
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) fail('EXT_SUPABASE_URL must look like https://<project-id>.supabase.co');
  if (!key) fail('EXT_SUPABASE_ANON_KEY is missing');
  if (key.startsWith('sb_secret_')) fail('that is a SECRET key. Extensions may only contain the PUBLISHABLE key (sb_publishable_...).');
  if (key.startsWith('eyJ')) { try { const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; if (role !== 'anon') fail(`JWT key has role "${role}"; only the anon/publishable key is allowed`); } catch (e) { if (String(e.message).startsWith('Extension')) throw e; fail('could not read key'); } }
  else if (!key.startsWith('sb_publishable_')) fail('key must start with sb_publishable_');
  if (!/^https?:\/\/[^\s/]+$/.test(api)) fail('EXT_API_BASE_URL must be a full URL like http://localhost:3000 or https://your-app.vercel.app');
  return { url, key, api };
}

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) {
    const inner = x > size * 0.28 && x < size * 0.72 && y > size * 0.28 && y < size * 0.72; const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = inner ? 255 : 17; raw[o + 1] = inner ? 255 : 24; raw[o + 2] = inner ? 255 : 39; raw[o + 3] = 255; } }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const cfg = resolveConfig();
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const define = { __SUPABASE_URL__: JSON.stringify(cfg.url), __SUPABASE_ANON_KEY__: JSON.stringify(cfg.key), __API_BASE_URL__: JSON.stringify(cfg.api), 'process.env.NODE_ENV': '"production"' };
const common = { bundle: true, minify: false, target: 'chrome110', define, logLevel: 'warning', jsx: 'automatic' };
await build({ ...common, entryPoints: [join(here, 'src/background.ts')], outfile: join(out, 'background.js'), format: 'esm' });
await build({ ...common, entryPoints: [join(here, 'src/content.ts')], outfile: join(out, 'content.js'), format: 'iife' });
await build({ ...common, entryPoints: [join(here, 'src/app/main.tsx')], outfile: join(out, 'app.js'), format: 'iife', loader: { '.css': 'css' } });
copyFileSync(join(here, 'src/app.html'), join(out, 'app.html'));
for (const s of [16, 48, 128]) writeFileSync(join(out, `icon${s}.png`), png(s));

const manifest = {
  manifest_version: 3, name: 'AfterSend', version: '0.1.0', description: 'Opt-in, per-email tracking for Gmail with an honest timeline.',
  permissions: ['storage', 'notifications', 'alarms'],
  host_permissions: ['https://mail.google.com/*', `${cfg.api}/*`, `${cfg.url}/*`],
  background: { service_worker: 'background.js', type: 'module' },
  content_scripts: [{ matches: ['https://mail.google.com/*'], js: ['content.js'], run_at: 'document_idle' }],
  action: { default_title: 'Open AfterSend' },
  icons: { 16: 'icon16.png', 48: 'icon48.png', 128: 'icon128.png' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Built extension into ${out}`);
