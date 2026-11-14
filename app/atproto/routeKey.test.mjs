// npm test: the website's route keys against the reference implementation's
// (lexicons/route_key.py), on real routes (lexicons/route_key_vectors.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latLngToCell } from 'h3-js';
import { keyCentroid, routeKey, routeKeys, shapeFor } from './routeKey.ts';

const { vectors } = JSON.parse(readFileSync(new URL('../../lexicons/route_key_vectors.json', import.meta.url), 'utf8'));

test('keys match the reference implementation', async () => {
  for (const v of vectors) assert.equal(await routeKey(v.line, v.shape), v.key, v.name);
  assert.deepEqual(await routeKeys(vectors.map((v) => ({ line: v.line, shape: v.shape }))), vectors.map((v) => v.key));
});

test('a key gives back its centroid cell', async () => {
  for (const v of vectors) {
    const c = await keyCentroid(v.key);
    assert.ok(c, v.name);
    assert.equal(latLngToCell(c[1], c[0], 10), v.centroid, v.name);
  }
});

test('anything else is not a key', async () => {
  for (const k of ['', 'abcdefghijklmnopqrstuvwxyz', '2K4RjYPAwNBJ', '1K4RjYPAxNBJ', '1K4RjYP!wNBJ', '1K4RjYPBwNBJ']) {
    assert.equal(await keyCentroid(k), null, k);
  }
});

test('shapes', () => {
  assert.equal(shapeFor('loop'), 'p');
  assert.equal(shapeFor('out-and-back'), 'b');
  assert.equal(shapeFor('one-way'), 'w');
  assert.equal(shapeFor('point-to-point'), 'w');
});
