import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { curatorFor, readFiles, saveFiles } from './store';

// Enough of D1 for store.ts, on SQLite: a batch is one transaction.
function d1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../curation/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: { run: () => Promise<unknown> }[]) => {
      db.exec('BEGIN');
      try { for (const s of ss) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  } as unknown as D1Database;
}

const A = 'fixtures/expect/alberta-banff-national-park.jsonl';
const B = 'fixtures/proposals/alberta-banff-national-park.jsonl';

describe('saveFiles', () => {
  let db: D1Database;
  beforeEach(() => { db = d1(); });

  it('saves new files at rev 1 and reads them back', async () => {
    expect(await saveFiles(db, { files: { [A]: 'a\n', [B]: 'b\n' }, base: {}, message: 'import' }, 'chris')).toEqual({ ok: true, revs: { [A]: 1, [B]: 1 } });
    expect(await readFiles(db)).toEqual([{ path: A, content: 'a\n', rev: 1 }, { path: B, content: 'b\n', rev: 1 }]);
  });

  it('saves a change from the rev it was read at', async () => {
    await saveFiles(db, { files: { [A]: 'a\n' }, base: {}, message: 'import' }, 'chris');
    expect(await saveFiles(db, { files: { [A]: 'a2\n' }, base: { [A]: 1 }, message: 'edit' }, 'chris')).toEqual({ ok: true, revs: { [A]: 2 } });
    expect((await readFiles(db))[0]).toEqual({ path: A, content: 'a2\n', rev: 2 });
  });

  it('refuses a save from a rev that has since changed, changing nothing', async () => {
    await saveFiles(db, { files: { [A]: 'a\n', [B]: 'b\n' }, base: {}, message: 'import' }, 'chris');
    await saveFiles(db, { files: { [A]: 'theirs\n' }, base: { [A]: 1 }, message: 'edit' }, 'pat');
    const r = await saveFiles(db, { files: { [A]: 'mine\n', [B]: 'mine\n' }, base: { [A]: 1, [B]: 1 }, message: 'edit' }, 'chris');
    expect(r).toMatchObject({ ok: false, status: 409, stale: [A] });
    expect((await readFiles(db)).map((f) => f.content)).toEqual(['theirs\n', 'b\n']);
  });

  it('rolls back the whole save when a racing save took a rev first', async () => {
    await saveFiles(db, { files: { [A]: 'a\n' }, base: {}, message: 'import' }, 'chris');
    // As if another save landed between the check and the write.
    await db.prepare("INSERT INTO file_rev (path, rev, content, author, message, created_at) VALUES (?, 1, 'x', 'pat', 'race', 'now')").bind(B).run();
    const r = await saveFiles(db, { files: { [A]: 'mine\n', [B]: 'mine\n' }, base: { [A]: 1 }, message: 'edit' }, 'chris');
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(await readFiles(db)).toEqual([{ path: A, content: 'a\n', rev: 1 }]);
  });

  it('only saves routes\' curated files', async () => {
    expect(await saveFiles(db, { files: { 'src/curate.rs': 'x' }, base: {}, message: 'm' }, 'chris')).toMatchObject({ ok: false, status: 400 });
    expect(await saveFiles(db, { files: { 'fixtures/expect/../../x.jsonl': 'x' }, base: {}, message: 'm' }, 'chris')).toMatchObject({ ok: false, status: 400 });
    expect(await saveFiles(db, { files: { 'fixtures/parks.json': '[]\n' }, base: {}, message: 'm' }, 'chris')).toMatchObject({ ok: true });
  });

  it('needs a message', async () => {
    expect(await saveFiles(db, { files: { [A]: 'a' }, base: {}, message: ' ' }, 'chris')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('curatorFor', () => {
  const keys = 'chris:k-one, pat:k-two';
  it('names the curator whose key it is', () => {
    expect(curatorFor('Bearer k-one', keys)).toBe('chris');
    expect(curatorFor('Bearer k-two', keys)).toBe('pat');
  });
  it('is null for a wrong, missing or malformed key', () => {
    expect(curatorFor('Bearer k-on', keys)).toBeNull();
    expect(curatorFor('Bearer k-one-more', keys)).toBeNull();
    expect(curatorFor(null, keys)).toBeNull();
    expect(curatorFor('k-one', keys)).toBeNull();
    expect(curatorFor('Bearer k-one', undefined)).toBeNull();
  });
});
