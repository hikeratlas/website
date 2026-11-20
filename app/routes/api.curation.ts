// The curation database (routes#252): a row per trail, for the
// /dev/regressions page and routes' export (fixtures/curation-export.py).
// Each read asks only for what it needs, to spare D1's rows read.
//
// GET: the parks, with their counts but not their rows: { head, parks }.
// GET ?park=<id>: one park, whole: { head, parks, listed, trails } (parks
//   empty if it isn't saved yet).
// GET ?since=<revision>: the parks with a row saved after that revision,
//   whole, the same shape (0: every park): routes' export.
// Each also gives `curator`: who the request's key belongs to, or null.
// `head` is the newest revision when read. Public, as routes' fixtures are.
// POST { parks, changes, message } with "Authorization: Bearer <curator
// key>": saves the rows (app/curation/store.ts), each from the rev it was
// read at (409 if one has changed).
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { envContext } from '~/cloudflare';
import { curatorFor, readChanged, readPark, readParks, saveRows, type Save } from '~/curation/store';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (status: number, error: string, more: object = {}) => Response.json({ error, ...more }, { status, headers: NO_STORE });

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.get(envContext);
  if (!env.CURATION) return fail(503, 'no curation database bound (CURATION)');
  const curator = curatorFor(request.headers.get('authorization'), env.CURATOR_KEYS);
  const q = new URL(request.url).searchParams;
  const park = q.get('park'), since = q.get('since');
  if (park !== null && !/^\d{1,20}$/.test(park)) return fail(400, 'park: an OSM id');
  if (since !== null && !/^\d{1,15}$/.test(since)) return fail(400, 'since: a revision number');
  try {
    const body = park !== null ? await readPark(env.CURATION, park)
      : since !== null ? await readChanged(env.CURATION, Number(since))
      : await readParks(env.CURATION);
    return Response.json({ ...body, curator }, { headers: NO_STORE });
  } catch (e) {
    // A new database without its tables (curation/README.md, step 3), or
    // without the latest migration.
    if (/no such (table|column)/i.test(String(e))) return fail(503, `the curation database needs its migrations (curation/migrations/, curation/sql.mjs --file): ${String(e).slice(0, 160)}`);
    throw e;
  }
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  if (request.method !== 'POST') return fail(405, 'POST only');
  const env = context.get(envContext);
  if (!env.CURATION) return fail(503, 'no curation database bound (CURATION)');
  const curator = curatorFor(request.headers.get('authorization'), env.CURATOR_KEYS);
  if (!curator) return fail(401, 'needs a curator key');
  let body: Save;
  try { body = await request.json() as Save; } catch { return fail(400, 'not JSON'); }
  const r = await saveRows(env.CURATION, body, curator);
  return r.ok ? Response.json(r, { headers: NO_STORE }) : fail(r.status, r.error, r.stale ? { stale: r.stale } : {});
};
