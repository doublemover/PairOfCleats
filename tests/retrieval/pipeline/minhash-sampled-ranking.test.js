#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  SimpleMinHash,
  minifyMinhashSignature,
  resolveMinhashSampledPlan
} from '../../../src/index/minhash.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';

const signature = (tokens) => {
  const hash = new SimpleMinHash();
  for (const token of tokens) hash.update(token);
  return [...hash.hashValues];
};
const corpus = [['alpha', 'beta'], ['alpha'], ['gamma'], ['alpha', 'beta']];
const full = corpus.map(signature);
const query = corpus[0];
for (const ratio of [2, 3, 5, 8]) {
  const sampling = resolveMinhashSampledPlan({ totalDocs: ratio * 1000, maxDocs: 1000, signatureLength: 128 });
  const signatures = full.map((row) => minifyMinhashSignature(row, sampling));
  const idx = { minhash: { signatures, sampling } };
  const querySig = minifyMinhashSignature(full[0], sampling);
  const expected = signatures.map((row, id) => ({
    idx: id,
    sim: row.filter((value, i) => value === querySig[i]).length / row.length
  })).sort((a, b) => b.sim - a.sim || a.idx - b.idx);
  assert.deepEqual(rankMinhash(idx, query, 4), expected);
  assert.equal(rankMinhash(idx, query, 1, new Set([0]))[0].sim, 1, 'identical sampled document must match its sampled query');
  assert.deepEqual(rankMinhash(idx, query, 4, new Set([1, 3])), expected.filter(({ idx: id }) => id === 1 || id === 3));

  // Full-width rows from incremental updates remain valid alongside older samples.
  idx.minhash.signatures[0] = full[0];
  idx.minhash.signatures[3] = Uint32Array.from(signatures[3]);
  assert.equal(rankMinhash(idx, query, 1, new Set([0]))[0].sim, 1);
  assert.equal(rankMinhash(idx, query, 1, new Set([3]))[0].sim, 1);

  // Missing/invalid sampling information cannot justify guessing a row's indices.
  for (const metadata of [null, {}, { ...sampling, mode: 'future-format' },
    { ...sampling, hashStride: 0 }, { ...sampling, hashStride: 1.5 },
    { ...sampling, signatureLength: 64 }, { ...sampling, sampledSignatureLength: 1 },
    { ...sampling, hashStride: Infinity }]) {
    idx.minhash.sampling = metadata;
    assert.deepEqual(rankMinhash(idx, query, 1, new Set([3])), []);
    assert.equal(rankMinhash(idx, query, 1, new Set([0]))[0].sim, 1);
  }
  idx.minhash.sampling = sampling;
  idx.minhash.signatures[3] = signatures[3].slice(1);
  assert.deepEqual(rankMinhash(idx, query, 1, new Set([3])), [], 'malformed sampled row width must be unavailable');
}
const legacy = { minhash: { signatures: full } };
assert.equal(rankMinhash(legacy, query, 1)[0].sim, 1);
assert.deepEqual(rankMinhash(legacy, [], 1), []);
console.log('minhash sampled ranking passed: actual sampling indices, mixed rows, filters, malformed metadata');
