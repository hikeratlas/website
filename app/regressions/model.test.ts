import { describe, expect, it } from 'vitest';
import { entryFor, type Proposal } from './model';

const p: Proposal = { park: 'Killarney Provincial Park', park_id: '14107244', region: 'Ontario', name: 'Chikanishing Trail', km: 3, source: 'x', status: 'open' };

describe('entryFor', () => {
  it("carries a proposal's shape into the entry it becomes", () => {
    expect(entryFor({ ...p, shape: 'loop' }, { status: 'accepted', trace: [[0, 0], [1, 1]] }).shape).toBe('loop');
  });
  it('gives no shape where the proposal has none', () => {
    expect('shape' in entryFor(p, { status: 'accepted', trace: [[0, 0], [1, 1]] })).toBe(false);
  });
});
