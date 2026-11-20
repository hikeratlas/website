import { describe, expect, it } from 'vitest';
import { withFields } from '~/regressions/model';
import { changesFor, newSlot, slotsOf } from './rows';

const rows = [
  { id: 'a', park_id: '1', pos: 0, rev: 3, data: '{"name": "A", "km": 17.0, "status": "open"}' },
  { id: 'b', park_id: '1', pos: 1, rev: 1, data: '{"name": "B", "km": 2, "status": "open"}' },
];

describe('changesFor', () => {
  it('sends nothing for rows as read', () => {
    expect(changesFor('listed', '1', slotsOf(rows))).toEqual([]);
  });
  it('sends a changed row from its rev, patched in place', () => {
    const s = slotsOf<{ status: string }>(rows);
    s[0].row = withFields(s[0].row!, { status: 'rejected' });
    expect(changesFor('listed', '1', s)).toEqual([{ table: 'listed', id: 'a', park_id: '1', base: 3, data: '{"name": "A", "km": 17.0, "status": "rejected"}' }]);
  });
  it('sends new rows from rev 0, and removed ones as null', () => {
    const s = [...slotsOf<object>(rows), newSlot<object>({ name: 'C' })];
    s[1].row = null;
    const c = changesFor('trail', '1', s);
    expect(c.map((x) => [x.id === s[2].id ? 'new' : x.id, x.base, x.data])).toEqual([['b', 1, null], ['new', 0, '{"name": "C"}']]);
  });
  it('sends nothing for a new row removed before saving', () => {
    const s = [newSlot<object | null>({ name: 'C' })];
    s[0].row = null;
    expect(changesFor('trail', '1', s)).toEqual([]);
  });
});
