import assert from 'node:assert/strict';
import { reusePriorChunkVectors } from '../../../tools/build/embeddings/prior-chunk-reuse.js';
const prior = { cacheMeta: { identityKey: 'qualified' }, chunkHashes: ['a','b','a','d'],
  codeVectors: [[1,0],[2,0],[3,0],[4,0]], docVectors: [[],[],[],[]], mergedVectors: [[1,0],[2,0],[3,0],[4,0]] };
const match = (hashes, extra = {}) => {
  const reuse = { code: Array(hashes.length).fill(null), doc: Array(hashes.length).fill(null), merged: Array(hashes.length).fill(null) };
  const count = reusePriorChunkVectors({ prior, chunkHashes: hashes, docTexts: hashes.map(() => ''), identityKey: 'qualified', expectedDims: 2, reuse, ...extra });
  return { count, reuse };
};
assert.equal(match(['a','edited','a','d']).count, 3);
assert.equal(match(['d','a','a','b']).count, 4);
assert.equal(match(['a','a','a']).count, 2, 'multiplicity cannot fabricate extra matching rows');
assert.equal(match(['new','b']).count, 1);
assert.equal(match(['a'], { identityKey: 'different' }).count, 0);
assert.equal(match(['a'], { expectedDims: 3 }).count, 0);
assert.equal(match(['a'], { docTexts: ['new doc'] }).count, 0);
assert.deepEqual(prior.chunkHashes, ['a','b','a','d']);
assert.equal(match(['a']).reuse.code[0], prior.codeVectors[0], 'reuse borrows immutable cache rows without detaching');
console.log('prior chunk partial reuse passed');