import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CHANGES, curatorFor, readAll, saveRows, type Change, type ParkRow } from './store';

// Enough of D1 for store.ts, on SQLite: a batch is one transaction.
function d1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../curation/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: raw.prepare(sql).all(...(args as never[])) }),
    run: async () => raw.prepare(sql).run(...(args as never[])),
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: ReturnType<typeof stmt>[]) => {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of ss) out.push(await s.all());
        raw.exec('COMMIT');
        return out;
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  } as unknown as D1Database;
  return { db, raw };
}

const BANFF: ParkRow = { park_id: '6365995', name: 'Banff National Park', region: 'Alberta', stem: 'alberta-banff-national-park', bbox: [-117.3, 50.7, -115.1, 52.3] };
const line = (o: object) => JSON.stringify(o);
const listed = (id: string, base: number, data: object | null, pos?: number): Change => ({ table: 'listed', id, park_id: BANFF.park_id, base, data: data && line(data), ...(pos !== undefined ? { pos } : {}) });
const trail = (id: string, base: number, data: object | null): Change => ({ table: 'trail', id, park_id: BANFF.park_id, base, data: data && line(data) });
const P = (name: string, status = 'open') => ({ park: BANFF.name, park_id: BANFF.park_id, name, km: 2, status });

describe('saveRows', () => {
  let db: D1Database, raw: DatabaseSync;
  beforeEach(() => { ({ db, raw } = d1()); });

  it('saves a park and its rows, in order, and reads them back', async () => {
    const r = await saveRows(db, { parks: [BANFF], changes: [listed('a', 0, P('Fenland'), 0), listed('b', 0, P('Johnston'), 1), trail('t', 0, { kind: 'trail', name: 'Fenland', park_id: BANFF.park_id })], message: 'import' }, 'chris');
    expect(r).toEqual({ ok: true, revs: { a: 1, b: 1, t: 1 } });
    const all = await readAll(db);
    expect(all.parks).toEqual([BANFF]);
    expect(all.listed.map((x) => [x.id, x.pos, x.rev, JSON.parse(x.data).name])).toEqual([['a', 0, 1, 'Fenland'], ['b', 1, 1, 'Johnston']]);
    expect(all.trails.map((x) => x.id)).toEqual(['t']);
    expect(raw.prepare('SELECT status FROM listed_trail WHERE id = ?').get('a')).toEqual({ status: 'open' });
  });

  it('puts a new row without a position last', async () => {
    await saveRows(db, { parks: [BANFF], changes: [listed('a', 0, P('A'), 0), listed('b', 0, P('B'), 5)], message: 'import' }, 'chris');
    await saveRows(db, { changes: [listed('c', 0, P('C'))], message: 'add' }, 'chris');
    expect((await readAll(db)).listed.map((x) => [x.id, x.pos])).toEqual([['a', 0], ['b', 5], ['c', 6]]);
  });

  it('keeps every version of a row, with who saved it and why', async () => {
    await saveRows(db, { parks: [BANFF], changes: [listed('a', 0, P('A'))], message: 'import' }, 'chris');
    await saveRows(db, { changes: [listed('a', 1, P('A', 'rejected'))], message: 'reject A' }, 'pat');
    await saveRows(db, { changes: [listed('a', 2, null)], message: 'remove A' }, 'chris');
    expect((await readAll(db)).listed).toEqual([]);
    expect(raw.prepare("SELECT rev, author, message, data IS NULL AS gone FROM revision WHERE item_id = 'a' ORDER BY rev").all())
      .toEqual([{ rev: 1, author: 'chris', message: 'import', gone: 0 }, { rev: 2, author: 'pat', message: 'reject A', gone: 0 }, { rev: 3, author: 'chris', message: 'remove A', gone: 1 }]);
  });

  it('refuses a save from a rev that has since changed, changing nothing', async () => {
    await saveRows(db, { parks: [BANFF], changes: [listed('a', 0, P('A')), listed('b', 0, P('B'))], message: 'import' }, 'chris');
    await saveRows(db, { changes: [listed('a', 1, P('A', 'accepted'))], message: 'theirs' }, 'pat');
    const r = await saveRows(db, { changes: [listed('a', 1, P('A', 'rejected')), listed('b', 1, P('B', 'rejected'))], message: 'mine' }, 'chris');
    expect(r).toMatchObject({ ok: false, status: 409, stale: ['a'] });
    expect((await readAll(db)).listed.map((x) => JSON.parse(x.data).status)).toEqual(['accepted', 'open']);
  });

  it('rolls back the whole save when a racing save took a rev first', async () => {
    await saveRows(db, { parks: [BANFF], changes: [listed('a', 0, P('A')), listed('b', 0, P('B'))], message: 'import' }, 'chris');
    // As if another save of b landed between the check and the write.
    raw.prepare("INSERT INTO revision (tbl, item_id, rev, data, author, message, created_at) VALUES ('listed_trail', 'b', 2, '{}', 'pat', 'race', 'now')").run();
    const r = await saveRows(db, { changes: [listed('a', 1, P('A', 'rejected')), listed('b', 1, P('B', 'rejected'))], message: 'mine' }, 'chris');
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((await readAll(db)).listed.map((x) => [x.rev, JSON.parse(x.data).status])).toEqual([[1, 'open'], [1, 'open']]);
  });

  it('needs every row\'s park, known or sent', async () => {
    expect(await saveRows(db, { changes: [listed('a', 0, P('A'))], message: 'm' }, 'chris')).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses malformed saves', async () => {
    const ok = { parks: [BANFF], message: 'm' };
    expect(await saveRows(db, { ...ok, changes: [listed('a b', 0, P('A'))] }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { ...ok, changes: [{ ...listed('a', 0, P('A')), data: '{not json' }] }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { ...ok, changes: [{ ...listed('a', 0, null), data: line({ park_id: '99', name: 'x' }) }] }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { ...ok, changes: [listed('a', 0, P('A')), listed('a', 0, P('A'))] }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { ...ok, message: ' ', changes: [listed('a', 0, P('A'))] }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { ...ok, changes: Array.from({ length: MAX_CHANGES + 1 }, (_, i) => listed(`r${i}`, 0, P(`R${i}`))) }, 'c')).toMatchObject({ status: 400 });
    expect(await saveRows(db, { parks: [{ ...BANFF, stem: '../x' }], changes: [], message: 'm' }, 'c')).toMatchObject({ status: 400 });
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
