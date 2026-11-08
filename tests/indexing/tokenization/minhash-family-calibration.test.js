import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SimpleMinHash } from '../../../src/index/minhash.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const signature = tokens => {
  const hash = new SimpleMinHash();
  for (const token of tokens) hash.update(token);
  return [...hash.hashValues];
};
const similarity = (a, b) => a.filter((value, index) => value === b[index]).length / a.length;
const seed = 0x5cb17329;
let random = seed;
const next = () => random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
const encode = (number, length) => String.fromCharCode(97 + Math.floor(number / 676),
  97 + Math.floor(number / 26) % 26, 97 + number % 26).padStart(length, 'a');
const samples = [];
let witness;
for (const length of [3, 5, 8]) {
  for (const overlap of [0, 4, 8, 12, 16, 24, 32]) {
    for (let trial = 0; trial < 100; trial++) {
      const pool = new Set();
      while (pool.size < 64) pool.add(encode(next() % 17576, length));
      const words = [...pool], common = words.slice(0, overlap);
      const a = [...common, ...words.slice(overlap, 32)];
      const b = [...common, ...words.slice(32, 64 - overlap)];
      assert.equal(a.length, 32); assert.equal(b.length, 32);
      assert.equal(new Set([...a, ...b]).size, 64 - overlap);
      assert.ok([...a, ...b].every(word => word.length === length));
      witness ||= a;
      samples.push({ length, overlap, trial, expected: overlap / (64 - overlap),
        observed: similarity(signature(a), signature(b)) });
    }
  }
}
const rmse = Math.sqrt(samples.reduce((sum, row) => sum + (row.observed - row.expected) ** 2, 0) / samples.length);
const bias = samples.reduce((sum, row) => sum + row.observed - row.expected, 0) / samples.length;
const { dir } = await prepareIsolatedTestCacheDir('minhash-family-calibration');
const identity = new SimpleMinHash().hashIdentity ?? null;
const sourceSha256 = createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
await fs.writeFile(path.join(dir, 'samples.json'), JSON.stringify({ node: process.version, identity,
  width: 128, seed, sourceSha256, rmse, bias, samples }, null, 2) + '\n');
console.log(JSON.stringify({ dir, pairs: samples.length, identity, rmse, bias }));
// With 128 independently useful coordinates the maximum binomial standard error
// is about 0.044. A broad aggregate allowance catches coordinate collapse without
// requiring any individual estimate to equal its exact Jaccard value.
assert.ok(rmse < 0.065, `aggregate MinHash error ${rmse} exceeds the calibration bound`);
assert.ok(Math.abs(bias) < 0.025, `aggregate MinHash bias ${bias} exceeds the calibration bound`);
for (const length of [3, 5, 8]) for (const overlap of [0, 4, 8, 12, 16, 24, 32]) {
  const rows = samples.filter(row => row.length === length && row.overlap === overlap);
  const mean = rows.reduce((sum, row) => sum + row.observed, 0) / rows.length;
  assert.ok(Math.abs(mean - rows[0].expected) < 0.04, `${length}/${overlap}: calibrated overlap bucket`);
}

const hash = new SimpleMinHash();
const winners = hash.seeds.map(seed => witness.reduce((best, token) =>
  hash.hash(token, seed) < hash.hash(best, seed) ? token : best));
assert.ok(new Set(winners).size >= 16, 'coordinates must select diverse minima instead of the same token');
assert.deepEqual(signature(witness), signature([...witness].reverse()));
assert.deepEqual(signature(witness), signature([...witness, ...witness]));
for (const partial of [['cat', 'fox'], ['dog', 'fox']]) {
  const estimate = similarity(signature(['cat', 'dog']), signature(partial));
  assert.ok(estimate > 0 && estimate < 1, 'same-length partial overlap must retain a useful estimate');
}
assert.equal(similarity(signature(['Aa']), signature(['BB'])), 0, 'polynomial collisions must not persist under every coordinate');
const idx = { minhash: { hashIdentity: identity,
  signatures: [signature(['cat', 'fox']), signature(['cat', 'dog'])] } };
assert.deepEqual(rankMinhash(idx, ['cat', 'dog'], 1), [{ idx: 1, sim: 1 }],
  'the exact document must outrank a same-minimum partial match');
assert.equal(rankMinhash(idx, ['cat', 'dog'], 2, new Set([0]))[0].idx, 0, 'candidate filters remain authoritative');
assert.deepEqual(rankMinhash(idx, ['cat', 'dog'], 2, new Set([1])), [{ idx: 1, sim: 1 }]);
console.log('MinHash calibration, coordinate diversity, collision, determinism and actual ranker checks passed');
