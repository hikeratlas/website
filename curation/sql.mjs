#!/usr/bin/env node
// SQL on the curation database, through the site (routes/api.curation.sql.ts),
// as an admin (a curator named in CURATION_ADMINS), with the key in
// CURATOR_KEY:
//
//   node curation/sql.mjs "SELECT name, status FROM listed_trail WHERE park_id = ?" 6365995
//   node curation/sql.mjs --file curation/migrations/0002_something.sql
//
// SITE defaults to https://www.hikeratlas.com. Prints each statement's rows
// as JSON lines, then what it changed.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const key = process.env.CURATOR_KEY;
const site = (process.env.SITE ?? 'https://www.hikeratlas.com').replace(/\/$/, '');
if (!key || !args.length) {
  console.error('usage: CURATOR_KEY=... [SITE=...] node curation/sql.mjs "SQL" [params...] | --file FILE');
  process.exit(2);
}
const body = args[0] === '--file' ? { script: readFileSync(args[1], 'utf8') } : { sql: args[0], params: args.slice(1) };
const r = await fetch(`${site}/api/curation/sql`, {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const out = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
if (!r.ok) { console.error(out.error); process.exit(1); }
for (const res of out.results) {
  for (const row of res.results) console.log(JSON.stringify(row));
  console.error(`-- ${res.results.length} rows, ${res.changes} changed, ${res.rows_read} read, ${res.rows_written} written`);
}
