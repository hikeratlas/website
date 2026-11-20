#!/usr/bin/env node
// node curation/import.mjs ROUTES_DIR [SITE]
//
// Copies routes' fixture files the regressions page edits
// (fixtures/proposals/*.jsonl, fixtures/expect/*.jsonl, fixtures/parks.json)
// into the curation database (routes#252), through the site's API
// (routes/api.curation.files.ts), with the curator key in CURATOR_KEY. SITE
// defaults to https://www.hikeratlas.com. Only files the database doesn't
// have yet, or has differently, are saved; run it once, when the database is
// new, after which the database is where these files are edited.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [routes, site = 'https://www.hikeratlas.com'] = process.argv.slice(2);
const key = process.env.CURATOR_KEY;
if (!routes || !key) {
  console.error('usage: CURATOR_KEY=... node curation/import.mjs ROUTES_DIR [SITE]');
  process.exit(2);
}
const api = `${site.replace(/\/$/, '')}/api/curation/files`;
const auth = { authorization: `Bearer ${key}` };

const want = {};
for (const dir of ['fixtures/proposals', 'fixtures/expect']) {
  for (const f of readdirSync(join(routes, dir)).filter((f) => f.endsWith('.jsonl')).sort()) want[`${dir}/${f}`] = readFileSync(join(routes, dir, f), 'utf8');
}
if (existsSync(join(routes, 'fixtures/parks.json'))) want['fixtures/parks.json'] = readFileSync(join(routes, 'fixtures/parks.json'), 'utf8');

const r = await fetch(api, { headers: auth });
if (!r.ok) throw new Error(`GET ${api}: ${r.status} ${await r.text()}`);
const { files: have, curator } = await r.json();
if (!curator) throw new Error('CURATOR_KEY is not a curator key');
const now = new Map(have.map((f) => [f.path, f]));
const files = {}, base = {};
for (const [p, c] of Object.entries(want)) {
  if (now.get(p)?.content === c) continue;
  files[p] = c;
  base[p] = now.get(p)?.rev ?? 0;
}
if (!Object.keys(files).length) {
  console.log('nothing to import: the database has these files as they are');
  process.exit(0);
}
let sha = '';
try { sha = execFileSync('git', ['-C', routes, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const message = `Imported from hikeratlas/routes${sha ? `@${sha}` : ''}`;
const s = await fetch(api, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ files, base, message }) });
if (!s.ok) throw new Error(`POST ${api}: ${s.status} ${await s.text()}`);
console.log(`${message}: ${Object.keys(files).length} files, as ${curator}`);
