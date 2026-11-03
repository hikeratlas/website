// A pmtiles.js source that merges nearby range requests.
//
// Routing needs a few dozen z14 tiles at once. Asked for one by one, R2 answers
// them roughly one after another, about 0.2 s apart, so 54 tiles took 12 s.
// But PMTiles stores tiles along a space-filling curve, so tiles near each
// other on the map are near each other in the file: requests made within a
// few milliseconds are merged into a few larger ranges (bridging gaps of up
// to MAX_GAP bytes), then sliced back up.

interface RangeResponse { data: ArrayBuffer; etag?: string; expires?: string; cacheControl?: string }
export interface Source {
  getKey(): string;
  getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse>;
}

const WINDOW_MS = 10;
const MAX_GAP = 64 * 1024;

interface Pending { offset: number; length: number; etag?: string; resolve: (r: RangeResponse) => void; reject: (e: unknown) => void }

export class CoalescingSource implements Source {
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  requests = 0; // ranges actually fetched, for diagnostics

  constructor(private base: Source) {}

  getKey() { return this.base.getKey(); }

  getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    return new Promise((resolve, reject) => {
      this.pending.push({ offset, length, etag, resolve, reject });
      if (!this.timer) this.timer = setTimeout(() => this.flush(), WINDOW_MS);
    });
  }

  private flush() {
    const batch = this.pending.sort((a, b) => a.offset - b.offset);
    this.pending = [];
    this.timer = null;
    let group: Pending[] = [];
    let end = -1;
    for (const p of batch) {
      if (group.length && p.offset > end + MAX_GAP) { this.fetchGroup(group); group = []; }
      group.push(p);
      end = Math.max(group.length > 1 ? end : -1, p.offset + p.length);
    }
    if (group.length) this.fetchGroup(group);
  }

  private async fetchGroup(group: Pending[]) {
    const start = group[0].offset;
    const end = Math.max(...group.map((p) => p.offset + p.length));
    this.requests++;
    try {
      const r = await this.base.getBytes(start, end - start, undefined, group[0].etag);
      for (const p of group) {
        p.resolve({ ...r, data: r.data.slice(p.offset - start, p.offset - start + p.length) });
      }
    } catch (e) {
      for (const p of group) p.reject(e);
    }
  }
}
