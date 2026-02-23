#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { buildChunkHashesFingerprint } from '../../../../tools/build/embeddings/cache.js';
import {
  buildChunkEmbeddingInputs,
  prepareFileEmbeddingWorkset
} from '../../../../tools/build/embeddings/runner/file-workset.js';

applyTestEnv();

const text = 'alpha beta gamma delta';
const items = [
  { index: 0, chunk: { start: 0, end: 5, docmeta: { doc: 'doc0' } } },
  { index: 1, chunk: { start: 6, end: 10, docmeta: { doc: '   ' } } },
  { index: 2, chunk: { start: 11, end: 16, docmeta: { doc: '  doc2  ' } } }
];

let reuseCall = null;
let scheduleCalls = 0;
const scheduleIo = async (worker) => {
  scheduleCalls += 1;
  return worker();
};

const first = await prepareFileEmbeddingWorkset({
  text,
  items,
  cacheState: { cacheEligible: true, cacheIndex: {} },
  cacheKey: 'cache-key',
  normalizedRel: 'src/file.js',
  scheduleIo,
  reuseVectorsFromPriorCacheEntryImpl: async (input) => {
    reuseCall = input;
    input.reuse.code[1] = [1, 2, 3];
    input.reuse.doc[1] = [4, 5, 6];
    input.reuse.merged[1] = [7, 8, 9];
    await input.scheduleIo(async () => null);
  }
});

const expectedFirstHashes = [
  sha1('alpha\ndoc0'),
  sha1('beta\n'),
  sha1('gamma\n  doc2  ')
];

assert.ok(reuseCall, 'expected prior-cache reuse helper to be invoked');
assert.equal(reuseCall.normalizedRel, 'src/file.js');
assert.equal(reuseCall.cacheKey, 'cache-key');
assert.equal(scheduleCalls, 1, 'expected scheduleIo to be used by reuse helper');
assert.deepEqual(first.chunkHashes, expectedFirstHashes);
assert.equal(
  first.chunkHashesFingerprint,
  buildChunkHashesFingerprint(expectedFirstHashes),
  'expected stable chunk hash fingerprint'
);
assert.deepEqual(first.codeMapping, [0, 2], 'expected reused chunks to be excluded from compute mapping');
assert.deepEqual(first.docMapping, [0, 2], 'expected doc mapping to stay aligned with code mapping');
assert.deepEqual(first.codeTexts, ['alpha', 'gamma']);
assert.deepEqual(first.docTexts, ['doc0', '  doc2  ']);
assert.deepEqual(first.reuse.code[1], [1, 2, 3]);
assert.deepEqual(first.reuse.doc[1], [4, 5, 6]);
assert.deepEqual(first.reuse.merged[1], [7, 8, 9]);

const second = await prepareFileEmbeddingWorkset({
  text: '0123456789',
  items: [{ index: 0, chunk: { start: 2, end: 6, docmeta: { doc: '  ' } } }],
  cacheState: { cacheEligible: true, cacheIndex: {} },
  cacheKey: null,
  normalizedRel: 'src/blank-doc.js',
  scheduleIo: async (worker) => worker(),
  reuseVectorsFromPriorCacheEntryImpl: async () => {}
});

assert.deepEqual(second.codeTexts, ['2345']);
assert.deepEqual(second.docTexts, [''], 'expected whitespace-only docs to normalize to empty text');
assert.deepEqual(second.codeMapping, [0]);
assert.deepEqual(second.docMapping, [0]);
assert.deepEqual(second.chunkHashes, [sha1('2345\n')]);

const inputs = buildChunkEmbeddingInputs({
  text: 'abcdef',
  items: [
    { chunk: { start: 1, end: 4.9, docmeta: { doc: '  keep spacing  ' } } },
    { chunk: { start: -3, end: -1, docmeta: { doc: '   ' } } },
    { chunk: { start: 'bad', end: 'also-bad', docmeta: { doc: 'doc2' } } }
  ]
});
assert.deepEqual(inputs.chunkCodeTexts, ['bcd', 'de', '']);
assert.deepEqual(inputs.chunkDocTexts, ['  keep spacing  ', '', 'doc2']);
assert.deepEqual(inputs.chunkHashes, [
  sha1('bcd\n  keep spacing  '),
  sha1('de\n'),
  sha1('\ndoc2')
]);

console.log('file workset prep helper test passed');
