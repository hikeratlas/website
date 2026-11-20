#!/usr/bin/env node
// node curation/import.mjs ROUTES_DIR [SITE]
//
// Copies routes' named regressions into the curation database (routes#252),
// a row per line: each park's proposals (fixtures/proposals/<stem>.jsonl)
// as its official list, and its entries (fixtures/expect/<stem>.jsonl) as
// its official trails, in their order, each line kept as written. Through
// the site's API (routes/api.curation.ts), with the curator key in
// CURATOR_KEY; SITE defaults to https://www.hikeratlas.com.
//
// A park already in the database is skipped, so a run cut short can be run
// again (a park cut short partway is named, to check). Run it once, when the database is new: after that, these are
// edited on /dev/regressions, and routes gets them by its export.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [routes, site = 'https://www.hikeratlas.com'] = process.argv.slice(2);
const key = process.env.CURATOR_KEY;
if (!routes || !key) {
  console.error('usage: CURATOR_KEY=... node curation/import.mjs ROUTES_DIR [SITE]');
  process.exit(2);
}
const api = `${site.replace(/\/$/, '')}/api/curation`;
const auth = { authorization: `Bearer ${key}` };
const MAX = 40;  // rows a save (store.ts' MAX_CHANGES)

const lines = (path) => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()) : [];
const stems = new Set();
for (const dir of ['proposals', 'expect']) {
  for (const f of readdirSync(join(routes, 'fixtures', dir))) if (f.endsWith('.jsonl')) stems.add(f.slice(0, -'.jsonl'.length));
}
const fixtures = existsSync(join(routes, 'fixtures/parks.json')) ? JSON.parse(readFileSync(join(routes, 'fixtures/parks.json'), 'utf8')) : [];

const r = await fetch(api, { headers: auth });
if (!r.ok) throw new Error(`GET ${api}: ${r.status} ${await r.text()}`);
const have = await r.json();
if (!have.curator) throw new Error('CURATOR_KEY is not a curator key');
const done = new Set(have.parks.map((p) => p.park_id));

let sha = '';
try { sha = execFileSync('git', ['-C', routes, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const message = `Imported from hikeratlas/routes${sha ? `@${sha}` : ''}`;

let parks = 0, rows = 0;
for (const stem of [...stems].sort()) {
  const listed = lines(join(routes, 'fixtures/proposals', `${stem}.jsonl`));
  const trails = lines(join(routes, 'fixtures/expect', `${stem}.jsonl`));
  const first = JSON.parse(listed[0] ?? trails[0]);
  const park_id = String(first.park_id ?? '');
  if (!park_id) { console.error(`skipped ${stem}: no park_id`); continue; }
  if (done.has(park_id)) {
    const n = have.listed.filter((x) => x.park_id === park_id).length + have.trails.filter((x) => x.park_id === park_id).length;
    if (n === listed.length + trails.length) console.log(`skipped ${stem}: already in the database`);
    else console.error(`skipped ${stem}: in the database with ${n} rows, not ${listed.length + trails.length} (a run cut short?): check it on /dev/regressions`);
    continue;
  }
  const fx = fixtures.find((f) => String(f.id ?? '') === park_id || (!f.id && f.park === first.park));
  // A park's region: its proposals'. One with only entries has none here,
  // and keeps its stem: the region is only for naming a new park's stem.
  const slug = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const region = listed.length ? JSON.parse(listed[0]).region ?? '' : '';
  const bbox = (listed.length && JSON.parse(listed[0]).park_bbox) || fx?.bbox || null;
  const park = { park_id, name: first.park, region, stem, bbox };
  if (stem !== `${slug(region)}-${slug(first.park)}` && region) console.error(`note: ${stem} isn't ${slug(region)}-${slug(first.park)}; kept as ${stem}`);
  const changes = [
    ...listed.map((data, pos) => ({ table: 'listed', id: randomUUID(), park_id, base: 0, data, pos })),
    ...trails.map((data, pos) => ({ table: 'trail', id: randomUUID(), park_id, base: 0, data, pos })),
  ];
  for (let i = 0; i < changes.length || i === 0; i += MAX) {
    const s = await fetch(api, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ parks: [park], changes: changes.slice(i, i + MAX), message }),
    });
    if (!s.ok) throw new Error(`POST ${api} (${stem}): ${s.status} ${await s.text()}`);
  }
  parks++; rows += changes.length;
  console.log(`${stem}: ${listed.length} listed, ${trails.length} official`);
}
console.log(`${message}: ${parks} parks, ${rows} rows, as ${have.curator}`);
