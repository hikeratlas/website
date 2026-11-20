// The curation database from the browser (routes/api.curation.ts), for the
// regressions page: read everything, and save changed rows with a curator's
// key, each from the rev it was read at.
import type { Change, Everything, ParkRow } from './store';

export type { Change, ParkRow, Row } from './store';
export interface Snapshot extends Everything { curator: string | null }

export class CurationError extends Error {
  constructor(public status: number, message: string, public stale?: string[]) { super(message); }
}

const API = '/api/curation';

export class Curation {
  constructor(public key: string | null) {}

  private headers(): Record<string, string> {
    return this.key ? { authorization: `Bearer ${this.key}` } : {};
  }

  async load(): Promise<Snapshot> {
    const r = await fetch(API, { cache: 'no-store', headers: this.headers() });
    const body = await r.json().catch(() => ({})) as Partial<Snapshot> & { error?: string };
    if (!r.ok || !body.parks || !body.listed || !body.trails) throw new CurationError(r.status, body.error ?? `${r.status} ${r.statusText}`);
    return { parks: body.parks, listed: body.listed, trails: body.trails, curator: body.curator ?? null };
  }

  async save(parks: ParkRow[], changes: Change[], message: string): Promise<Record<string, number>> {
    const r = await fetch(API, {
      method: 'POST', cache: 'no-store',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ parks, changes, message }),
    });
    const body = await r.json().catch(() => ({})) as { revs?: Record<string, number>; error?: string; stale?: string[] };
    if (!r.ok || !body.revs) throw new CurationError(r.status, body.error ?? `${r.status} ${r.statusText}`, body.stale);
    return body.revs;
  }
}
