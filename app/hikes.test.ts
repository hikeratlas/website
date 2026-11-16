import { describe, expect, it } from 'vitest';
import { sortParks, type RegionItem } from './hikes';

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
