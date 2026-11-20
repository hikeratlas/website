# The curation database

Official trails and the official lists they come from (routes#252), a row
per trail, edited on `/dev/regressions`
(`migrations/0001_init.sql`):

- `park`: name, region, the stem routes' files name it by, and its box.
- `listed_trail`: a trail as the park's official source lists it (routes'
  proposals).
- `trail`: an official trail (routes' expect entries).
- `revision`: every version of every row, with who saved it and why.

A row's `data` is the row as routes' files spell it, kept as written, so
routes' `fixtures/curation-export.py` writes `fixtures/proposals/` and
`fixtures/expect/` back byte for byte, changed only where a row was. It runs
nightly in routes, as a pull request (`.github/workflows/curation-export.yml`).

## Setting it up

1. Cloudflare dashboard, Storage & Databases → D1 → Create: `curation`
   (or `npx wrangler d1 create curation`).
2. Workers & Pages → the site's Pages project → Settings:
   - Bindings → Add → D1 database: variable name `CURATION`, the `curation`
     database;
   - Variables and Secrets → Add → Secret: `CURATOR_KEYS`, `name:key` pairs,
     comma-separated, e.g. `chris:` and the output of `openssl rand -hex 24`.
     A curator puts their key in the regressions page's Settings; their name
     goes on each save.
   - Variables and Secrets → Add → Text: `CURATION_ADMINS`, the curators
     (names in `CURATOR_KEYS`) who may run raw SQL, e.g. `chris`.

   For Production, and Preview if wanted; then redeploy.
3. Its tables, once deployed, each migration in turn:
   `CURATOR_KEY=<key> node curation/sql.mjs --file curation/migrations/0001_init.sql`
   (then `0002_park_counts.sql`, …)
   (the D1 console drops newlines, so a migration's first comment swallows
   it there).
4. Import routes' regressions, once:
   `CURATOR_KEY=<key> node curation/import.mjs ../routes`. A park already in
   the database is skipped, so it can be run again if cut short.

After the import these are edited on the page, not in routes: the export
overwrites them there.

## The API

`/api/curation` (`app/routes/api.curation.ts`, `app/curation/store.ts`):

Each read asks only for what it needs, to spare D1's rows read:

- `GET`: the parks, with their counts (`listed_n`, `open_n`, `trail_n`,
  kept by triggers) but not their rows: `{ head, parks }`.
- `GET ?park=<id>`: one park, whole: `{ head, parks, listed, trails }`, its
  live rows `{ id, park_id, pos, rev, data }`.
- `GET ?since=<revision>`: the parks with a row saved after that revision,
  whole (`0`: all): routes' export, which keeps its place in
  `fixtures/curation.json`.

Each also gives `curator`, the name for the request's key
(`Authorization: Bearer <key>`), or null; `head` is the newest revision.
Public, as routes' fixtures are.
- `POST { parks, changes, message }` with a curator key: `changes` are rows
  (`{ table: 'listed' | 'trail', id, park_id, base, data, pos? }`): new
  (`base` 0, with an id the caller makes), changed, or removed (`data`
  null), each from the rev it was read at (`base`). A row changed since is
  refused (409), and nothing is saved. At most 40 rows a save: a query a row
  keeps a save within D1's Free plan's 50 queries a request.

## SQL

`/api/curation/sql` (`app/routes/api.curation.sql.ts`), for admins (curators
named in `CURATION_ADMINS`, with their key): migrations, fixes, and
questions the page can't answer.

- `POST { sql, params? }`: one statement, with `?` parameters.
- `POST { script }`: a script, such as a migration file, comments and all,
  split into its statements and run as one batch (all or none), at most 45.

From a terminal: `CURATOR_KEY=<key> node curation/sql.mjs "SELECT …" [params]`
or `--file FILE`. Each call is logged (the site's Workers logs) with who ran
it.
