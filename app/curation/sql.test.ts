import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { splitStatements } from './sql';

describe('splitStatements', () => {
  it('splits at semicolons, dropping comments', () => {
    expect(splitStatements('-- a comment; not split\nSELECT 1; /* x; y */ SELECT 2;\n')).toEqual(['SELECT 1', 'SELECT 2']);
  });
  it("keeps semicolons in strings and a trigger's body", () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b', 'it''s');\nCREATE TRIGGER x AFTER INSERT ON t BEGIN INSERT INTO u VALUES (1); INSERT INTO u VALUES (2); END;\nSELECT 3"))
      .toEqual(["INSERT INTO t VALUES ('a;b', 'it''s')", 'CREATE TRIGGER x AFTER INSERT ON t BEGIN INSERT INTO u VALUES (1); INSERT INTO u VALUES (2); END', 'SELECT 3']);
  });
  it("doesn't take a column named like a keyword for one", () => {
    expect(splitStatements('SELECT begin_at, ended FROM t; SELECT 1')).toEqual(['SELECT begin_at, ended FROM t', 'SELECT 1']);
  });
  it('splits the first migration into statements SQLite runs', () => {
    const sql = readFileSync(new URL('../../curation/migrations/0001_init.sql', import.meta.url), 'utf8');
    const ss = splitStatements(sql);
    expect(ss.length).toBe(10);
    const db = new DatabaseSync(':memory:');
    for (const s of ss) db.exec(s);
    expect(db.prepare("SELECT type, count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type ORDER BY type").all())
      .toEqual([{ type: 'index', n: 2 }, { type: 'table', n: 4 }, { type: 'trigger', n: 4 }]);
    // And the second after it.
    for (const s of splitStatements(readFileSync(new URL('../../curation/migrations/0002_park_counts.sql', import.meta.url), 'utf8'))) db.exec(s);
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'").get()).toEqual({ n: 8 });
  });
});
