-- The curation database (routes#252): official trails and the official
-- lists they come from, edited on the website's /dev/regressions page.
-- For now it holds routes' fixture files as they are (fixtures/proposals/,
-- fixtures/expect/, fixtures/parks.json), whole, so the page works as it
-- did on GitHub and routes reads them back unchanged (its
-- fixtures/curation-export.py). Bound to the site as CURATION.
--
--   npx wrangler d1 migrations apply curation --remote

-- Each file as it is now. A file emptied (content '') is gone: removed from
-- routes on export.
CREATE TABLE file (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Every version of every file: the history. A save writes rev n + 1 of each
-- file it changes, so two saves made from the same rev can't both land (the
-- second fails on the unique key, and none of its files change).
CREATE TABLE file_rev (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  rev INTEGER NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (path, rev)
);
