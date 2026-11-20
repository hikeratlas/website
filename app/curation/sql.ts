// Raw SQL on the curation database, for admins (routes/api.curation.sql.ts):
// one statement with parameters, or a script, such as a migration, split
// into its statements. Kept apart from the route so it can be tested.

// A script's statements: split at each ';' that ends one, outside quotes,
// comments and a trigger's BEGIN ... END; comments dropped. Enough for this
// database's migrations, not a SQL parser.
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let cur = '', depth = 0, i = 0;
  const word = (w: string) => script.slice(i, i + w.length).toUpperCase() === w && !/\w/.test(script[i - 1] ?? '') && !/\w/.test(script[i + w.length] ?? '');
  while (i < script.length) {
    const c = script[i];
    if (c === '-' && script[i + 1] === '-') { while (i < script.length && script[i] !== '\n') i++; continue; }
    if (c === '/' && script[i + 1] === '*') { const e = script.indexOf('*/', i + 2); i = e < 0 ? script.length : e + 2; cur += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < script.length && !(script[j] === c && script[j + 1] !== c)) j += script[j] === c ? 2 : 1;
      cur += script.slice(i, j + 1); i = j + 1; continue;
    }
    if (word('BEGIN') && /\bCREATE\s+(TEMP\w*\s+)?TRIGGER\b/i.test(cur)) depth++;
    else if (depth && word('END')) depth--;
    if (c === ';' && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface SqlResult { results: unknown[]; changes: number; rows_read: number; rows_written: number }

// One statement with its parameters, or several in one batch (one
// transaction: all or none).
export async function runSql(db: D1Database, statements: string[], params: unknown[] = []): Promise<SqlResult[]> {
  const prepared = statements.map((s) => (statements.length === 1 && params.length ? db.prepare(s).bind(...params) : db.prepare(s)));
  const rs = statements.length === 1 ? [await prepared[0].all()] : await db.batch(prepared);
  return rs.map((r) => ({
    results: r.results ?? [],
    changes: r.meta?.changes ?? 0,
    rows_read: r.meta?.rows_read ?? 0,
    rows_written: r.meta?.rows_written ?? 0,
  }));
}
