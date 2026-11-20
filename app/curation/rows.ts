// The regressions page's rows: each proposal and entry with the database
// row it is (its id and the rev read), so a save sends only the rows that
// changed, each from its rev (routes/api.curation.ts).
import { lineOf, parseJsonl } from '~/regressions/model';
import type { Change, Row, Table } from './store';

// A row as read, and what it is now: row null once removed; rev 0 and
// line null for one not saved yet.
export interface Slot<T> { id: string; rev: number; line: string | null; row: T | null }

export const slotsOf = <T,>(rows: Row[]): Slot<T>[] => rows.map((r) => ({ id: r.id, rev: r.rev, line: r.data, row: parseJsonl<T>(r.data)[0] ?? null }));

export const newSlot = <T,>(row: T): Slot<T> => ({ id: crypto.randomUUID(), rev: 0, line: null, row });

// The rows to save: those whose line isn't the line read, new ones, and
// removed ones (a new one removed before saving is nothing).
export function changesFor<T>(table: Table, park_id: string, slots: Slot<T>[]): Change[] {
  const out: Change[] = [];
  for (const s of slots) {
    if (s.row === null) {
      if (s.rev) out.push({ table, id: s.id, park_id, base: s.rev, data: null });
      continue;
    }
    const line = lineOf(s.row);
    if (line !== s.line) out.push({ table, id: s.id, park_id, base: s.rev, data: line });
  }
  return out;
}
