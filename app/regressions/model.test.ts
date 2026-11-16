import { describe, expect, it } from 'vitest';
import type { LngLat } from '~/routing/graph';
import { entryFor, passes, type Entry, type Proposal } from './model';

const p: Proposal = { park: 'Killarney Provincial Park', park_id: '14107244', region: 'Ontario', name: 'Chikanishing Trail', km: 3, source: 'x', status: 'open' };

describe('entryFor', () => {
  it("carries a proposal's shape into the entry it becomes", () => {
    expect(entryFor({ ...p, shape: 'loop' }, { status: 'accepted', trace: [[0, 0], [1, 1]] }).shape).toBe('loop');
  });
  it('gives no shape where the proposal has none', () => {
    expect('shape' in entryFor(p, { status: 'accepted', trace: [[0, 0], [1, 1]] })).toBe(false);
  });
});

describe('passes, with trace_off_m', () => {
  // A 1 km line east along 49°N, and a hike that also goes 300 m north
  // and back at its far end.
  const east = (m: number): LngLat => [-120 + m / (111320 * Math.cos((49 * Math.PI) / 180)), 49];
  const trace: LngLat[] = [east(0), east(500), east(1000)];
  const spur: LngLat[] = [...trace, [east(1000)[0], 49 + 300 / 110570], east(1000)];
  const e: Entry = { kind: 'trail', name: 'Gibson', park: 'P', park_id: '1', km: 1.6, trace, trace_end_m: null };
  it('fails a hike that detours off the trace', () => {
    const c = passes({ ...e, trace_off_m: 200 }, 'Gibson', 1.6, spur);
    expect(c.stays).toBe(false);
    expect(c.offM).toBeGreaterThan(450);
    expect(c.ok).toBe(false);
  });
  it('passes one that keeps to it, and is unchecked without trace_off_m', () => {
    expect(passes({ ...e, trace_off_m: 200 }, 'Gibson', 1.6, trace).stays).toBe(true);
    const c = passes(e, 'Gibson', 1.6, spur);
    expect(c.stays).toBe(null);
    expect(c.ok).toBe(true);
  });
});
