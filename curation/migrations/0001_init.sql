-- The curation database (routes#252): official trails, and the official
-- lists they come from, edited on the website's /dev/regressions page. A row
-- per trail. Routes gets them back as its fixture files
-- (fixtures/proposals/, fixtures/expect/) by its fixtures/curation-export.py.
-- Bound to the site as CURATION.
--
--   npx wrangler d1 migrations apply curation --remote

-- A park with listed or official trails: its name and region (as routes'
-- regions.json names them), the stem routes' files name it by
-- (<region>-<park>, slugged), and the box around it (W, S, E, N), for a
-- routes fixture.
CREATE TABLE park (
  park_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  stem TEXT NOT NULL UNIQUE,
  bbox TEXT,
  updated_at TEXT NOT NULL
);

-- A trail as a park's official source lists it (a "proposal": routes'
-- fixtures/proposals.py describes its fields). `data` is the row as routes'
-- files spell it, kept as written so an export changes only what was
-- changed; name and status are copied out of it, to query. `pos` is its
-- place in the park's list. data NULL: removed.
CREATE TABLE listed_trail (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT,
  name TEXT,
  status TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX listed_trail_park ON listed_trail (park_id, pos);

-- An official trail: an entry as routes' fixtures/expect/ spells it (its
-- expectations.py), mostly kind "trail" with a trace; also the few "dest"
-- and "featured" checks. Kept as listed_trail is.
CREATE TABLE trail (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT,
  kind TEXT,
  name TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX trail_park ON trail (park_id, pos);

-- Every version of every row: the history, written by the triggers below
-- as each row is saved (so a save is one query a row: D1's Free plan allows
-- 50 a request). A save writes rev n + 1 of each row it changes, so two
-- saves from the same rev can't both land: the second fails on the unique
-- key, and none of its rows change.
CREATE TABLE revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT,
  author TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tbl, item_id, rev)
);

CREATE TRIGGER listed_trail_added AFTER INSERT ON listed_trail BEGIN
  INSERT INTO revision (tbl, item_id, rev, data, author, message, created_at)
  VALUES ('listed_trail', NEW.id, NEW.rev, NEW.data, NEW.updated_by, NEW.message, NEW.updated_at);
END;
CREATE TRIGGER listed_trail_saved AFTER UPDATE OF rev ON listed_trail BEGIN
  INSERT INTO revision (tbl, item_id, rev, data, author, message, created_at)
  VALUES ('listed_trail', NEW.id, NEW.rev, NEW.data, NEW.updated_by, NEW.message, NEW.updated_at);
END;
CREATE TRIGGER trail_added AFTER INSERT ON trail BEGIN
  INSERT INTO revision (tbl, item_id, rev, data, author, message, created_at)
  VALUES ('trail', NEW.id, NEW.rev, NEW.data, NEW.updated_by, NEW.message, NEW.updated_at);
END;
CREATE TRIGGER trail_saved AFTER UPDATE OF rev ON trail BEGIN
  INSERT INTO revision (tbl, item_id, rev, data, author, message, created_at)
  VALUES ('trail', NEW.id, NEW.rev, NEW.data, NEW.updated_by, NEW.message, NEW.updated_at);
END;
