// The curation database from the browser (routes/api.curation.ts), for the
// regressions page: the list of parks (with counts), one park whole, and
// saving changed rows with a curator's key, each from the rev it was read at.
import type { Change, ParkRow, ParkSummary, Parks } from './store';

export type { Change, ParkRow, ParkSummary, Row } from './store';

export class CurationError extends Error {
  constructor(public status: number, message: string, public stale?: string[]) { super(message); }
}

const API = '/api/curation';

export class Curation {
  constructor(public key: string | null) {}

  private headers(): Record<string, string> {
    return this.key ? { authorization: `Bearer ${this.key}` } : {};
  }

  private async get<T>(q: string): Promise<T & { curator: string | null }> {
    const r = await fetch(`${API}${q}`, { cache: 'no-store', headers: this.headers() });
    const body = await r.json().catch(() => ({})) as T & { curator?: string | null; error?: string };
    if (!r.ok || body.error) throw new CurationError(r.status, body.error ?? `${r.status} ${r.statusText}`);
    return { ...body, curator: body.curator ?? null };
  }

  parks() { return this.get<{ head: number; parks: ParkSummary[] }>(''); }
  park(id: string) { return this.get<Parks>(`?park=${encodeURIComponent(id)}`); }

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
