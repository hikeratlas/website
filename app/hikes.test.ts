import { describe, expect, it } from 'vitest';
import { parkBox, sortParks, type RegionItem } from './hikes';

const park = (name: string, hikes: number, rank?: number): RegionItem => ({ name, path: `/${name}`, id: name, hikes, rank });
const names = (xs: RegionItem[]) => xs.map((x) => x.name);

describe('sortParks (#168)', () => {
  const parks = [
    park('La Verendrye Provincial Park', 140, 0),
    park('Algonquin Provincial Park', 90, 50_000),
    park('Bruce Peninsula National Park', 30, 20_000),
    park('Arrowhead Provincial Park', 30),
  ];

  it('orders by fame, then hikes', () => {
    expect(names(sortParks(parks, 'popular'))).toEqual([
      'Algonquin Provincial Park', 'Bruce Peninsula National Park', 'La Verendrye Provincial Park', 'Arrowhead Provincial Park',
    ]);
  });

  it('orders by hikes, then name', () => {
    expect(names(sortParks(parks, 'hikes'))).toEqual([
      'La Verendrye Provincial Park', 'Algonquin Provincial Park', 'Arrowhead Provincial Park', 'Bruce Peninsula National Park',
    ]);
  });

  it('orders by the name the card shows', () => {
    expect(names(sortParks([park('Zed Park', 1), park('Algonquin Provincial Park', 1), park('Bruce Peninsula National Park', 1)], 'name')))
      .toEqual(['Algonquin Provincial Park', 'Bruce Peninsula National Park', 'Zed Park']);
  });

  it("doesn't change the list it's given", () => {
    const before = names(parks);
    sortParks(parks, 'name');
    expect(names(parks)).toEqual(before);
  });
});

describe('parkBox (#193)', () => {
  const park = { id: '1', name: 'P', outline: [[[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]] as [number, number][]] };
  it('is the outline, with a margin', () => {
    const [w, s, e, n] = parkBox(park, null)!;
    expect([w, s, e, n].map((v) => +v.toFixed(2))).toEqual([-1.2, -0.6, 11.2, 5.6]);
  });
  it('takes in hikes outside the outline', () => {
    expect(parkBox(park, [-10, 1, 2, 2])![0]).toBeCloseTo(-10 - 20 * 0.12);
  });
  it('is the hikes\' box without an outline', () => {
    expect(parkBox({ id: '1', name: 'P' }, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(parkBox(undefined, null)).toBeNull();
  });
});
