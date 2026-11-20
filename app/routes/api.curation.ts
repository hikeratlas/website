// The curation database (routes#252): a row per trail, for the
// /dev/regressions page and routes' export (fixtures/curation-export.py).
//
// GET: everything, as { parks, listed, trails, curator }: each park, and
// each live row ({ id, park_id, pos, rev, data }) of its official list and
// its official trails. Public, as routes' fixtures are; `curator` is who the
// request's key belongs to, or null.
// POST { parks, changes, message } with "Authorization: Bearer <curator
// key>": saves the rows (app/curation/store.ts), each from the rev it was
// read at (409 if one has changed).
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { envContext } from '~/cloudflare';
import { curatorFor, readAll, saveRows, type Save } from '~/curation/store';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (status: number, error: string, more: object = {}) => Response.json({ error, ...more }, { status, headers: NO_STORE });

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const env = context.get(envContext);
  if (!env.CURATION) return fail(503, 'no curation database bound (CURATION)');
  const curator = curatorFor(request.headers.get('authorization'), env.CURATOR_KEYS);
  return Response.json({ ...(await readAll(env.CURATION)), curator }, { headers: NO_STORE });
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
