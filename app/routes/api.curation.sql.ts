// Raw SQL on the curation database (routes#252), for admins: curators named
// in CURATION_ADMINS, with their key ("Authorization: Bearer <key>"). For
// migrations (curation/migrations/), fixes and questions the page can't
// answer; curation/sql.mjs calls it from a terminal.
//
// POST { sql, params? }: one statement, with ? parameters.
// POST { script }: several statements (a migration file, comments and
// all), run as one batch: all or none.
// Answers { results: [{ results, changes, rows_read, rows_written }] }, one
// a statement, or { error } with the database's message.
import type { ActionFunctionArgs } from 'react-router';
import { envContext } from '~/cloudflare';
import { splitStatements, runSql } from '~/curation/sql';
import { curatorFor } from '~/curation/store';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

export const loader = () => fail(405, 'POST { sql, params } or { script }');

export const action = async ({ request, context }: ActionFunctionArgs) => {
  if (request.method !== 'POST') return fail(405, 'POST only');
  const env = context.get(envContext);
  if (!env.CURATION) return fail(503, 'no curation database bound (CURATION)');
  const who = curatorFor(request.headers.get('authorization'), env.CURATOR_KEYS);
  const admins = (env.CURATION_ADMINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!who) return fail(401, 'needs a curator key');
  if (!admins.includes(who)) return fail(403, `${who} isn't an admin (CURATION_ADMINS)`);
  let body: { sql?: unknown; params?: unknown; script?: unknown };
  try { body = await request.json() as typeof body; } catch { return fail(400, 'not JSON'); }
  let statements: string[], params: unknown[] = [];
  if (typeof body.script === 'string') {
    statements = splitStatements(body.script);
  } else if (typeof body.sql === 'string') {
    statements = [body.sql];
    if (body.params !== undefined && !Array.isArray(body.params)) return fail(400, 'params must be a list');
    params = (body.params as unknown[] | undefined) ?? [];
  } else return fail(400, 'needs sql or script');
  if (!statements.length) return fail(400, 'no statements');
  // Each statement is a query: D1's Free plan allows 50 a request.
  if (statements.length > 45) return fail(400, `${statements.length} statements: at most 45 a request`);
  console.log(`curation sql by ${who}: ${statements.map((s) => s.slice(0, 200)).join(' ;; ')}`);
  try {
    return Response.json({ results: await runSql(env.CURATION, statements, params) }, { headers: NO_STORE });
  } catch (e) {
    return fail(400, String((e as Error).message ?? e));
  }
};
