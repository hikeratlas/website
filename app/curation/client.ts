// The curation database from the browser (routes/api.curation.files.ts), for
// the regressions page: read every file, and save changed ones with a
// curator's key, each from the rev it was read at.

export interface Snapshot { files: Map<string, { content: string; rev: number }>; curator: string | null }

export class CurationError extends Error {
  constructor(public status: number, message: string, public stale?: string[]) { super(message); }
}

const URL_ = '/api/curation/files';

export class Curation {
  constructor(public key: string | null) {}

  private headers(): Record<string, string> {
    return this.key ? { authorization: `Bearer ${this.key}` } : {};
  }

  async load(): Promise<Snapshot> {
    const r = await fetch(URL_, { cache: 'no-store', headers: this.headers() });
    const body = await r.json().catch(() => ({})) as { files?: { path: string; content: string; rev: number }[]; curator?: string | null; error?: string };
    if (!r.ok || !body.files) throw new CurationError(r.status, body.error ?? `${r.status} ${r.statusText}`);
    return { files: new Map(body.files.map((f) => [f.path, { content: f.content, rev: f.rev }])), curator: body.curator ?? null };
  }

  // Each file's new content ('' removes it), saved from the rev in `snap`.
  async save(snap: Snapshot, files: Record<string, string>, message: string): Promise<Record<string, number>> {
    const base = Object.fromEntries(Object.keys(files).map((p) => [p, snap.files.get(p)?.rev ?? 0]));
    const r = await fetch(URL_, {
      method: 'POST', cache: 'no-store',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ files, base, message }),
    });
    const body = await r.json().catch(() => ({})) as { revs?: Record<string, number>; error?: string; stale?: string[] };
    if (!r.ok || !body.revs) throw new CurationError(r.status, body.error ?? `${r.status} ${r.statusText}`, body.stale);
    return body.revs;
  }
}
