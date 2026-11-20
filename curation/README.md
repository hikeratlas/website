# The curation database

Official trails and the official lists they come from (routes#252), edited
on `/dev/regressions`. To start with, it holds routes' fixture files as they
are (`fixtures/proposals/*.jsonl`, `fixtures/expect/*.jsonl`,
`fixtures/parks.json`), whole, with every version kept (`file_rev`). Routes
gets them back with its `fixtures/curation-export.py`, nightly, as a pull
request (its `.github/workflows/curation-export.yml`).

## Setting it up

1. Create the database: `npx wrangler d1 create curation`.
2. Create its tables: `npx wrangler d1 migrations apply curation --remote`,
   with a `wrangler.toml` naming it (or paste
   `migrations/0001_init.sql` into the dashboard's D1 console).
3. In the Pages project's settings, for Production (and Preview, if wanted):
   - bind the database as `CURATION`;
   - add a secret `CURATOR_KEYS`: `name:key` pairs, comma-separated, e.g.
     `chris:<a long random key>` (`openssl rand -hex 24`). A curator types
     their key into the regressions page's Settings; their name goes on each
     save.
4. Import routes' files, once:
   `CURATOR_KEY=<key> node curation/import.mjs ../routes` (it saves only
   files the database doesn't have, or has differently).

After the import, these files are edited on the page, not in routes: the
export overwrites them there.

## The API

`/api/curation/files` (`app/routes/api.curation.files.ts`):

- `GET`: every file, `{ files: [{ path, content, rev }], curator }`. Public,
  as routes' fixtures are. `curator` is the name for the request's key
  (`Authorization: Bearer <key>`), or null.
- `POST { files, base, message }` with a curator key: saves the files (`''`
  removes one), each from the rev it was read at (`base`); a file changed
  since is refused (409) and nothing is saved.
